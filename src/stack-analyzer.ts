/**
 * Stack trace analysis utilities
 * Parse stack trace and extract code context for AI analysis
 */

import axios from "axios";
import { loadConfig } from "./config.js";

export interface StackFrame {
  className: string;
  methodName: string;
  filePath: string;
  lineNumber: number;
  rawLine: string;
}

export interface StackFrameWithCode {
  frame: StackFrame;
  code: string;
  startLine: number;
  endLine: number;
}

/**
 * Remove strings and comments from a line to avoid counting braces inside them
 * Handles: single-line strings, multi-line text blocks (Java 15+), comments
 */
function cleanLine(line: string, inTextBlock: { active: boolean }): string {
  let cleaned = line;
  
  // 处理 Java 15+ text blocks ("""...""")
  if (inTextBlock.active) {
    const endIndex = cleaned.indexOf('"""');
    if (endIndex !== -1) {
      cleaned = cleaned.substring(endIndex + 3);
      inTextBlock.active = false;
    } else {
      return ''; // 整行都在 text block 中
    }
  }
  
  const textBlockStart = cleaned.indexOf('"""');
  if (textBlockStart !== -1) {
    const textBlockEnd = cleaned.indexOf('"""', textBlockStart + 3);
    if (textBlockEnd !== -1) {
      // 单行 text block
      cleaned = cleaned.substring(0, textBlockStart) + cleaned.substring(textBlockEnd + 3);
    } else {
      // 多行 text block 开始
      inTextBlock.active = true;
      cleaned = cleaned.substring(0, textBlockStart);
    }
  }
  
  // 移除单行注释
  const commentIndex = cleaned.indexOf('//');
  if (commentIndex !== -1) {
    cleaned = cleaned.substring(0, commentIndex);
  }
  
  // 移除块注释（单行）
  cleaned = cleaned.replace(/\/\*[^]*?\*\//g, '');
  
  // 移除字符串字面量（更准确地处理转义）
  cleaned = cleaned.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  cleaned = cleaned.replace(/'(?:[^'\\]|\\.)*'/g, "''");
  
  return cleaned;
}

/**
 * Find method boundaries in Java code (improved)
 * Returns the start and end line numbers of the method containing targetLine
 * Supports multi-line signatures and better brace counting
 * Time Complexity: O(n) where n is the number of lines to scan
 */
function findMethodBoundaries(
  lines: string[],
  targetLineIndex: number,
  startLineNumber: number
): { methodStart: number; methodEnd: number } | null {
  // 注解行（如 @Override、@CommandHandler）
  const annotationPattern = /^\s*@[\w.]+(\([^)]*\))?\s*$/;
  
  // 方法签名起始（有修饰符的行）
  const methodStartPattern = /^\s*(@[\w.]+(\([^)]*\))?\s*)*(public|private|protected|static|final|synchronized|native|abstract|default|strictfp)\b/;
  
  // 无修饰符的方法签名（包级访问权限）：必须有明确的返回类型
  // 返回类型必须是: 基本类型(void/int/boolean等) 或 大写开头的引用类型 或 泛型
  // 例如: void check() 或 String getName() 或 <T> List<T> getList()
  // 明确排除: 仅有方法名和括号的调用语句，如 setVirtualOperatorForOnlineCancel(...)
  const packageMethodPattern = /^\s*(?!return\b|throw\b|new\b|case\b|else\b|if\b|while\b|for\b|switch\b)(<[^>]+>\s*)?(void|boolean|byte|char|short|int|long|float|double|[A-Z]\w*[\w<>\[\].,\s]*)\s+\w+\s*\(/;

  // 定位：向上找到方法签名起始（支持多行签名）
  let signatureStartIndex = -1;
  let signatureEndIndex = -1;
  
  for (let i = targetLineIndex; i >= 0; i--) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (!trimmed) continue; // 跳过空行
    
    // 跳过注释
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    // 向上扫描：若遇到块注释的结束符，说明当前位于注释块中，应继续向上直到其起始符
    if (line.includes('*/')) {
      while (i >= 0 && !lines[i].includes('/*')) i--;
      continue;
    }
    
    // 找到方法签名起始（包含修饰符或无修饰符）
    const hasModifier = methodStartPattern.test(line);
    // 额外防护：避免把调用表达式误判为方法签名
    let safePackageCandidate = false;
    if (!hasModifier && packageMethodPattern.test(line)) {
      const parenIndex = line.indexOf('(');
      const dotBefore = parenIndex !== -1 ? line.lastIndexOf('.', parenIndex) : -1;
      const hasAssignment = line.includes('=');
      safePackageCandidate = parenIndex !== -1 && dotBefore === -1 && !hasAssignment;
    }
    const isPackageMethod =
      !hasModifier &&
      safePackageCandidate &&
      !trimmed.startsWith('if') &&
      !trimmed.startsWith('while') &&
      !trimmed.startsWith('for') &&
      !trimmed.startsWith('switch') &&
      !trimmed.startsWith('return') &&
      !trimmed.startsWith('throw') &&
      !trimmed.startsWith('else') &&
      !trimmed.startsWith('case ');
    
    if (hasModifier || isPackageMethod) {
      signatureStartIndex = i;
      
      // 向下扫描找到完整签名（到 { 或 声明式 ; 为止）
      let foundEnd = false;
      for (let j = i; j < lines.length; j++) {
        const rawSig = lines[j];
        const sigLine = rawSig.trim();
        const hasOpeningBrace = sigLine.includes('{');
        const endsWithSemicolon = /;\s*$/.test(sigLine);
        // 仅当分号行看起来像“方法声明”才视为签名结束，避免把普通调用当作声明
        let looksLikeDeclarationWithSemicolon = false;
        if (endsWithSemicolon) {
          const parenIndex = rawSig.indexOf('(');
          const hasClosingParen = parenIndex !== -1 && rawSig.indexOf(')', parenIndex) !== -1;
          const dotBefore = parenIndex !== -1 ? rawSig.lastIndexOf('.', parenIndex) : -1;
          const hasAssignment = rawSig.includes('=');
          looksLikeDeclarationWithSemicolon = hasClosingParen && dotBefore === -1 && !hasAssignment;
        }
        if (hasOpeningBrace || looksLikeDeclarationWithSemicolon) {
          signatureEndIndex = j;
          foundEnd = true;
          break;
        }
        // 避免扫描太远（最多30行）
        if (j - i > 30) break;
      }
      
      if (foundEnd) break;
    }
  }
  
  if (signatureStartIndex === -1 || signatureEndIndex === -1) return null;

  // 向上合并连续注解行为方法起始（包含 @Override 等）
  let methodStartIndex = signatureStartIndex;
  for (let i = signatureStartIndex - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.trim()) { // 空行打断注解块
      break;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) break; // 单行注释打断
    if (annotationPattern.test(line)) {
      methodStartIndex = i;
      continue;
    }
    // 非注解的非空行则停止扩展
    break;
  }

  // 处理无方法体（抽象方法或接口声明以分号结尾）
  const signatureLine = lines[signatureEndIndex];
  const hasOpeningBraceOnSignature = signatureLine.includes('{');
  const endsWithSemicolon = /;\s*$/.test(signatureLine);
  if (endsWithSemicolon && !hasOpeningBraceOnSignature) {
    // 无方法体：方法终止于签名行
    return {
      methodStart: startLineNumber + methodStartIndex,
      methodEnd: startLineNumber + signatureEndIndex,
    };
  }

  // 使用括号计数寻找方法结束 "}"
  let braceLevel = 0;
  let methodEndIndex = signatureEndIndex; // 默认至少包含签名行
  let seenOpeningBrace = false;
  const textBlockState = { active: false };

  // 从签名行开始向下查找，遇到第一个 "{" 后，配对到对应的 "}"
  for (let i = signatureEndIndex; i < lines.length; i++) {
    const raw = lines[i];
    
    // 使用改进的清理函数移除字符串和注释
    const cleaned = cleanLine(raw, textBlockState);

    for (const ch of cleaned) {
      if (ch === '{') {
        braceLevel++;
        seenOpeningBrace = true;
      } else if (ch === '}') {
        braceLevel--;
      }
    }

    // 已进入方法体且层级回到 0，则本方法结束于该行
    if (seenOpeningBrace && braceLevel === 0) {
      methodEndIndex = i;
      break;
    }
  }

  // 兜底：若未进入方法体（极少情况）或未找到结束，设为文件末尾
  if (!seenOpeningBrace) {
    // 若没有方法体（例如错误的匹配），将结束置为签名行
    methodEndIndex = signatureEndIndex;
  } else if (braceLevel !== 0) {
    methodEndIndex = lines.length - 1;
  }

  return {
    methodStart: startLineNumber + methodStartIndex,
    methodEnd: startLineNumber + methodEndIndex,
  };
}

/**
 * Get entire file content from Bitbucket using raw API
 * More efficient than browse API - no line limit, returns plain text
 */
async function getFileContent(
  filePath: string,
  branch: string
): Promise<string[]> {
  const config = loadConfig();
  const { bitbucket } = config;
  const auth = Buffer.from(`${bitbucket.username}:${bitbucket.password}`).toString("base64");

  // 使用 raw API 获取完整文件内容（无行数限制）
  const url = `${bitbucket.baseUrl}/rest/api/1.0/projects/${bitbucket.project}/repos/${bitbucket.repo}/raw/${filePath}`;
  
  const response = await axios.get(url, {
    params: {
      at: branch,
    },
    headers: {
      Authorization: `Basic ${auth}`,
    },
    responseType: 'text', // 确保返回文本而非JSON
  });

  // 将文本按行分割
  return response.data.split('\n');
}

/**
 * Get code context around a specific line from Bitbucket
 * Fetches the entire file and intelligently extracts the method containing the target line
 * Exported for use in MCP tools
 */
export async function getCodeContext(
  filePath: string,
  targetLine: number,
  branch: string
): Promise<{ code: string; startLine: number; endLine: number }> {
  try {
    // 获取整个文件内容
    const allLines = await getFileContent(filePath, branch);
    
    if (targetLine > allLines.length) {
      throw new Error(`Target line ${targetLine} exceeds file length ${allLines.length}`);
    }
    
    // 智能检测方法边界
    const methodBoundaries = findMethodBoundaries(allLines, targetLine - 1, 1);
    
    if (methodBoundaries) {
      // 成功找到方法边界，提取完整方法
      const methodStartIndex = methodBoundaries.methodStart - 1;
      const methodEndIndex = methodBoundaries.methodEnd - 1;

      // 在方法范围内重新定位签名行（避免返回注解），并仅返回方法本体（不增加上下文）
        const methodSignaturePattern = /^\s*(@[\w.]+(\([^)]*\))?\s*)*(public|private|protected|static|final|synchronized|native|abstract|default|strictfp)\b/;

      let signatureIndex = -1;
      for (let i = methodStartIndex; i <= methodEndIndex; i++) {
        if (methodSignaturePattern.test(allLines[i])) {
          signatureIndex = i;
          break;
        }
      }
      const startIndex = signatureIndex !== -1 ? signatureIndex : methodStartIndex;
      const endIndex = methodEndIndex;

      const methodLines = allLines.slice(startIndex, endIndex + 1);
      const code = methodLines.join('\n');

      return {
        code,
        startLine: startIndex + 1,
        endLine: endIndex + 1,
      };
    } else {
      // 没找到方法边界，返回合理范围
      const reasonableContext = 50;
      const fallbackStart = Math.max(0, targetLine - 1 - reasonableContext);
      const fallbackEnd = Math.min(allLines.length - 1, targetLine - 1 + reasonableContext);
      
      const contextLines = allLines.slice(fallbackStart, fallbackEnd + 1);
      const code = contextLines.join('\n');
      
      return {
        code,
        startLine: fallbackStart + 1,
        endLine: fallbackEnd + 1,
      };
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      // 如果文件不存在或无法获取，返回错误提示
      return {
        code: `[无法获取代码: ${error.response?.status} - ${error.message}]`,
        startLine: targetLine,
        endLine: targetLine,
      };
    }
    throw error;
  }
}
