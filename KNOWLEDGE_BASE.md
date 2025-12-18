# 错误知识库构建指南

本文档详细说明 `build_error_knowledge_base` 工具的工作流程、技术实现和使用方法。

## 📋 目录

- [概述](#概述)
- [核心机制](#核心机制)
- [工作流程](#工作流程)
- [技术实现](#技术实现)
- [使用指南](#使用指南)
- [实施路线](#实施路线)

---

## 概述

### 什么是错误知识库？

错误知识库是一个 **AI 驱动的智能系统**，它能够：
- 📊 自动收集每次错误处理的完整记录
- 🧠 智能分析和聚合相似错误模式
- 🔍 提供语义搜索和相似度匹配
- 📚 沉淀可复用的解决方案和最佳实践

### 核心价值

```
传统方式：
错误处理 → 修复 → 结束 → 经验消失 ❌

知识库方式：
错误处理 → 修复 → 自动记录 → AI分析 → 
知识沉淀 → 经验复用 → 持续增值 ✅
```

**关键优势：**
- ⚡ 新人修复效率提升 **10倍**（从2小时 → 10分钟）
- 🎯 避免重复踩坑，相同错误不再反复出现
- 📈 知识资产随时间增值（数据越多，价值越大）
- 🎓 隐性经验显性化（老员工离职不带走经验）

---

## 核心机制

### 三层架构

```
┌─────────────────────────────────────────────┐
│ 第三层：知识应用（用户查询）                 │
├─────────────────────────────────────────────┤
│ • 语义搜索                                   │
│ • 相似度匹配                                 │
│ • 智能推荐方案                               │
└─────────────────┬───────────────────────────┘
                  │
                  ↓
┌─────────────────────────────────────────────┐
│ 第二层：知识构建（定期执行）                 │
├─────────────────────────────────────────────┤
│ • AI 自动分类                                │
│ • 聚合相似错误                               │
│ • 提取通用模式                               │
│ • 生成知识节点                               │
└─────────────────┬───────────────────────────┘
                  │
                  ↓
┌─────────────────────────────────────────────┐
│ 第一层：数据积累（实时自动）                 │
├─────────────────────────────────────────────┤
│ • 错误记录保存                               │
│ • 结构化数据提取                             │
│ • 向量化存储                                 │
└─────────────────────────────────────────────┘
```

### 数据结构

每次错误处理自动生成的记录：

```typescript
interface ErrorRecord {
  // 基础信息
  id: string;                    // 唯一标识
  timestamp: Date;               // 发生时间
  
  // 错误定位
  filePath: string;              // 文件路径
  lineNumber: number;            // 行号
  errorType: string;             // 错误类型（NPE/逻辑错误/数据库异常等）
  errorMessage: string;          // 错误信息
  stackTrace: string;            // 完整堆栈
  
  // 代码信息
  codeOwner: string;             // 责任人
  commitId: string;              // Commit ID
  prInfo: string;                // PR 信息
  
  // 分析结果
  rootCause: string;             // 根因分析（AI生成）
  fixSolution: string;           // 修复方案
  codeExample: string;           // 代码示例
  
  // 工单信息
  jiraTicket: string;            // JIRA 工单号
  fixTime: number;               // 修复耗时（分钟）
  
  // 分类标签
  moduleTag: string;             // 模块标签（寿险/财险/理赔等）
  businessTag: string;           // 业务标签（金额计算/规则引擎等）
  severityLevel: string;         // 严重程度（致命/严重/一般）
}
```

---

## 工作流程

### 阶段 1：数据自动积累（实时）

**触发时机**：每次使用 `track_error_full` 或相关工具处理错误时

```typescript
// 在现有工具中自动执行
server.registerTool("track_error_full", {
  // ... 现有逻辑
}, async (args) => {
  // 1. 执行错误调查和JIRA创建
  const result = await investigateAndCreateJira(args);
  
  // 2. 自动保存错误记录
  const record: ErrorRecord = {
    id: generateUUID(),
    timestamp: new Date(),
    filePath: args.filePath,
    lineNumber: args.lineNumber,
    errorType: classifyErrorType(args.errorMessage),
    errorMessage: args.errorMessage,
    stackTrace: args.stackTrace,
    codeOwner: result.codeOwner,
    commitId: result.commitId,
    prInfo: result.prInfo,
    rootCause: result.analysis.rootCause,
    fixSolution: result.analysis.suggestion,
    jiraTicket: result.jiraKey,
    fixTime: calculateFixTime(),
    moduleTag: extractModuleTag(args.filePath),
    businessTag: extractBusinessTag(args.errorMessage),
    severityLevel: calculateSeverity(args)
  };
  
  // 3. 持久化存储
  await saveErrorRecord(record);
  
  // 4. 向量化（用于语义搜索）
  await vectorizeAndStore(record);
  
  return result;
});
```

**存储方式：**

| 存储类型 | 用途 | 技术方案 |
|---------|------|---------|
| **关系数据库** | 结构化查询 | PostgreSQL / MySQL |
| **向量数据库** | 语义搜索 | Pinecone / Weaviate / Qdrant |
| **文件系统**（可选） | 备份和导出 | JSON 文件 |

---

### 阶段 2：知识智能构建（定期执行）

**触发方式：**
- 手动触发：管理员执行 `build_error_knowledge_base` 工具
- 自动触发：定时任务（每周/每月）
- 阈值触发：新增记录超过 N 条时

**执行流程：**

```typescript
async function buildKnowledgeBase() {
  // 步骤 1：加载所有错误记录
  const records = await db.errorRecords.findAll({
    where: {
      processedInKB: false  // 未处理的记录
    }
  });
  
  console.log(`📊 加载 ${records.length} 条新记录`);
  
  // 步骤 2：AI 自动分类
  const classified = await aiClassifyErrors(records);
  /*
  分类维度：
  - 错误类型：空指针/逻辑错误/数据库异常/接口超时...
  - 业务领域：理赔/承保/核保/保全...
  - 技术层级：Controller/Service/DAO/Utils...
  - 严重程度：致命/严重/一般/轻微...
  */
  
  // 步骤 3：聚合相似错误
  const clusters = await aiClusterSimilarErrors(classified);
  /*
  示例聚合：
  聚类 1："理赔金额计算错误"
  - 包含 12 个相似案例
  - 共同特征：金额翻倍/折扣未生效
  - 共同根因：运算符错误（7次）、配置错误（3次）、精度问题（2次）
  - 通用解决方案：检查运算符 + 验证配置 + 使用BigDecimal
  */
  
  // 步骤 4：提取通用模式
  const patterns = await aiExtractPatterns(clusters);
  /*
  模式示例：
  - 金额计算必须用 BigDecimal
  - 状态流转必须加事务
  - 外部调用需要超时控制
  */
  
  // 步骤 5：生成知识节点
  const knowledgeNodes = clusters.map(cluster => ({
    id: generateId(),
    title: cluster.pattern,              // "理赔金额计算错误"
    category: cluster.category,          // "业务逻辑错误"
    description: cluster.description,    // 详细描述
    
    relatedCases: cluster.cases.map(c => ({
      jiraTicket: c.jiraTicket,
      filePath: c.filePath,
      rootCause: c.rootCause,
      solution: c.fixSolution
    })),
    
    commonCauses: cluster.rootCauses,    // 常见根因列表
    solutions: cluster.solutions,        // 通用解决方案
    codeTemplates: cluster.templates,    // 代码模板
    preventionTips: cluster.tips,        // 预防建议
    bestPractices: patterns[cluster.id], // 最佳实践
    
    frequency: cluster.cases.length,     // 出现频率
    avgFixTime: calculateAvg(cluster.cases.map(c => c.fixTime)),
    
    keywords: extractKeywords(cluster),  // 关键词（用于搜索）
    vector: cluster.embedding,           // 向量（用于语义搜索）
    
    createdAt: new Date(),
    updatedAt: new Date()
  }));
  
  // 步骤 6：保存到知识库
  await db.knowledgeBase.bulkUpsert(knowledgeNodes);
  
  // 步骤 7：更新记录状态
  await db.errorRecords.update({
    processedInKB: true
  }, {
    where: { id: records.map(r => r.id) }
  });
  
  console.log(`✅ 生成 ${knowledgeNodes.length} 个知识节点`);
  
  return {
    totalRecords: records.length,
    knowledgeNodes: knowledgeNodes.length,
    categories: groupBy(knowledgeNodes, 'category')
  };
}
```

---

### 阶段 3：智能检索应用（用户查询）

**使用场景：** 用户遇到新错误时，自动匹配知识库

```typescript
server.registerTool("search_similar_errors", {
  description: "在知识库中搜索相似错误和解决方案",
  inputSchema: {
    errorType: z.string().describe("错误类型"),
    errorMessage: z.string().describe("错误信息"),
    keywords: z.string().optional().describe("关键词")
  }
}, async ({ errorType, errorMessage, keywords }) => {
  
  // 方式 1：向量相似度搜索（AI语义理解）
  const semanticQuery = `${errorType} ${errorMessage} ${keywords || ''}`;
  const embedding = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: semanticQuery
  });
  
  const semanticMatches = await vectorDB.query({
    vector: embedding.data[0].embedding,
    topK: 5,
    threshold: 0.85  // 相似度阈值 85%
  });
  
  // 方式 2：关键词匹配（补充）
  const keywordMatches = await db.knowledgeBase.findAll({
    where: {
      OR: [
        { keywords: { contains: keywords } },
        { category: errorType }
      ]
    },
    limit: 5
  });
  
  // 合并和排序结果
  const matches = mergeAndRankResults(semanticMatches, keywordMatches);
  
  // 格式化输出
  return {
    content: [{
      type: "text",
      text: formatKnowledgeMatches(matches)
    }]
  };
});
```

**输出示例：**

```
🔍 知识库匹配结果（找到 3 个相似案例）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【匹配 1】相似度：95%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

知识节点：理赔金额计算错误
分类：业务逻辑错误
历史案例：12 个

【常见根因】
1. 运算符错误（* 写成 /）- 7 次
2. 折扣系数配置错误 - 3 次
3. BigDecimal 精度丢失 - 2 次

【通用解决方案】
✓ 检查 Calculator 类的运算逻辑
✓ 验证折扣系数来源和取值范围
✓ 确保使用 BigDecimal 而非 double
✓ 添加金额计算单元测试

【代码模板】
```java
@Test
public void testDiscountCalculation() {
    BigDecimal base = new BigDecimal("10000");
    BigDecimal rate = new BigDecimal("0.5");
    BigDecimal result = base.multiply(rate);
    assertEquals(new BigDecimal("5000"), result);
}
```

【最佳实践】
• 金额计算必须用 BigDecimal
• 保留 4 位小数，使用 HALF_UP 舍入
• 避免使用 double 进行金额运算

【参考案例】
• JIRA-1256：李四修复（2周前）- ClaimCalculator.java:161
• JIRA-890：张三修复（1月前）- PremiumService.java:89
• 培训视频："保险金额计算的防御性编程.mp4"

平均修复时间：20 分钟

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【匹配 2】相似度：82%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

知识节点：空指针异常 - 金额计算模块
...
```

---

## 技术实现

### 方案对比

| 实现方案 | 优点 | 缺点 | 推荐度 |
|---------|------|------|-------|
| **方案 1：纯文件系统** | • 实现简单<br>• 无需额外组件 | • 查询慢<br>• 无语义搜索<br>• 难以扩展 | ⭐⭐ POC |
| **方案 2：关系数据库** | • 结构化查询<br>• 事务支持<br>• 成熟稳定 | • 语义搜索弱<br>• 需要精确关键词 | ⭐⭐⭐ 小规模 |
| **方案 3：向量数据库** | • AI 语义搜索<br>• 相似度匹配<br>• 扩展性好 | • 需要额外组件<br>• 学习成本 | ⭐⭐⭐⭐ 推荐 |
| **方案 4：混合架构** | • 关系DB存储<br>• 向量DB检索<br>• 两全其美 | • 架构复杂<br>• 运维成本高 | ⭐⭐⭐⭐⭐ 生产 |

### 推荐架构（混合方案）

```
┌─────────────────────────────────────────┐
│         应用层（MCP Server）             │
└───────────┬─────────────────────────────┘
            │
            ├─────────────┬───────────────┐
            ↓             ↓               ↓
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ PostgreSQL   │  │ Pinecone     │  │ Redis        │
│ (结构化存储) │  │ (语义搜索)   │  │ (缓存)       │
└──────────────┘  └──────────────┘  └──────────────┘
```

**技术选型：**

```typescript
// 1. 关系数据库：PostgreSQL
import { Pool } from 'pg';
const pool = new Pool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

// 2. 向量数据库：Pinecone
import { Pinecone } from '@pinecone-database/pinecone';
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY
});

// 3. AI 模型：OpenAI
import { OpenAI } from 'openai';
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 4. 缓存：Redis（可选）
import { createClient } from 'redis';
const redis = createClient({
  url: process.env.REDIS_URL
});
```

---

## 使用指南

### 初始设置

#### 1. 数据库初始化

```sql
-- 创建错误记录表
CREATE TABLE error_records (
  id UUID PRIMARY KEY,
  timestamp TIMESTAMP NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  line_number INTEGER NOT NULL,
  error_type VARCHAR(100) NOT NULL,
  error_message TEXT NOT NULL,
  stack_trace TEXT,
  code_owner VARCHAR(100),
  commit_id VARCHAR(100),
  pr_info TEXT,
  root_cause TEXT,
  fix_solution TEXT,
  jira_ticket VARCHAR(50),
  fix_time INTEGER,
  module_tag VARCHAR(100),
  business_tag VARCHAR(100),
  severity_level VARCHAR(20),
  processed_in_kb BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 创建知识库表
CREATE TABLE knowledge_base (
  id UUID PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  category VARCHAR(100) NOT NULL,
  description TEXT,
  common_causes JSONB,
  solutions JSONB,
  code_templates JSONB,
  prevention_tips JSONB,
  frequency INTEGER,
  avg_fix_time DECIMAL,
  keywords TEXT[],
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 创建案例关联表
CREATE TABLE kb_case_relations (
  kb_id UUID REFERENCES knowledge_base(id),
  error_id UUID REFERENCES error_records(id),
  PRIMARY KEY (kb_id, error_id)
);

-- 创建索引
CREATE INDEX idx_error_type ON error_records(error_type);
CREATE INDEX idx_module_tag ON error_records(module_tag);
CREATE INDEX idx_processed ON error_records(processed_in_kb);
CREATE INDEX idx_kb_category ON knowledge_base(category);
```

#### 2. 向量数据库设置

```typescript
// 初始化 Pinecone 索引
async function initVectorDB() {
  const index = pinecone.index('error-knowledge');
  
  // 创建命名空间
  await index.namespace('error-records').upsert([]);
  await index.namespace('knowledge-base').upsert([]);
  
  console.log('✅ 向量数据库初始化完成');
}
```

### 日常使用

#### 场景 1：自动积累数据

**无需操作**，每次处理错误时自动保存：

```
用户：处理一个空指针异常
  ↓
系统：自动调用 track_error_full
  ↓
系统：自动保存错误记录到数据库
  ↓
系统：自动向量化并存储
  ↓
完成（用户无感知）✅
```

#### 场景 2：构建知识库

**手动触发**（推荐每周执行一次）：

```
输入给 AI：
"请构建错误知识库，分析最近新增的错误记录"

AI 自动执行：
1. 调用 build_error_knowledge_base 工具
2. 加载未处理的记录
3. AI 分类和聚合
4. 生成知识节点
5. 返回统计报告

输出：
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 知识库构建完成
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
处理记录：45 条
生成知识节点：12 个

分类统计：
• 业务逻辑错误：5 个
• 空指针异常：3 个
• 数据库异常：2 个
• 接口超时：2 个

高频问题 TOP 3：
1. 理赔金额计算错误（12 次）
2. 年金计算空指针（8 次）
3. 状态流转失败（6 次）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

#### 场景 3：查询知识库

**自动触发**（遇到错误时）：

```
用户输入：
"理赔系统报金额计算错误，请帮我分析"

AI 自动流程：
1. 理解问题
2. 自动调用 search_similar_errors
3. 返回匹配的知识节点
4. 提供解决建议

输出：
🔍 在知识库中找到相似案例...
[显示匹配结果和解决方案]
```

---

## 实施路线

### Phase 1：数据积累（1-2周）✅ 可快速启动

**目标：** 建立数据收集基础

```typescript
// 修改现有工具，增加记录保存
async function trackErrorFull(args) {
  const result = await originalTrackError(args);
  
  // 保存到本地文件（最简单方案）
  const record = {
    timestamp: new Date(),
    ...args,
    ...result
  };
  
  await fs.appendFile(
    './knowledge-base/records.jsonl',
    JSON.stringify(record) + '\n'
  );
  
  return result;
}
```

**交付物：**
- ✅ 每次错误处理自动保存记录
- ✅ JSON Lines 格式存储
- ✅ 开始积累数据

---

### Phase 2：简单查询（2-3周）

**目标：** 实现基础检索功能

```typescript
// 新增工具：关键词搜索
server.registerTool("search_error_history", {
  description: "搜索历史错误记录",
  inputSchema: {
    keywords: z.string()
  }
}, async ({ keywords }) => {
  // 读取所有记录
  const content = await fs.readFile('./knowledge-base/records.jsonl', 'utf-8');
  const records = content.split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
  
  // 简单关键词匹配
  const matches = records.filter(r =>
    r.errorType.includes(keywords) ||
    r.rootCause?.includes(keywords) ||
    r.filePath.includes(keywords)
  );
  
  return formatResults(matches);
});
```

**交付物：**
- ✅ 历史记录查询功能
- ✅ 关键词匹配
- ✅ 初步可用

---

### Phase 3：AI 增强（1-2月）⭐ 推荐

**目标：** 实现完整的知识库系统

**技术栈：**
- PostgreSQL（数据存储）
- Pinecone（向量搜索）
- OpenAI（AI分析）

**实现步骤：**

1. **数据迁移**（1周）
```bash
# 迁移现有记录到数据库
node scripts/migrate-to-db.js
```

2. **向量化**（1周）
```typescript
// 批量向量化历史记录
for (const record of records) {
  const embedding = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: `${record.errorType} ${record.rootCause}`
  });
  
  await pinecone.upsert([{
    id: record.id,
    values: embedding.data[0].embedding,
    metadata: record
  }]);
}
```

3. **知识构建**（2周）
```typescript
// 实现 build_error_knowledge_base 工具
server.registerTool("build_error_knowledge_base", {
  // ... 完整实现
});
```

4. **语义搜索**（1周）
```typescript
// 实现 search_similar_errors 工具
server.registerTool("search_similar_errors", {
  // ... 完整实现
});
```

**交付物：**
- ✅ 完整的知识库系统
- ✅ AI 驱动的分类和聚合
- ✅ 语义搜索和相似度匹配
- ✅ 生产级可用

---

### Phase 4：优化增强（持续）

**后续迭代：**

- 🔄 自动化定时任务（每周自动构建）
- 📊 可视化面板（展示知识库统计）
- 🎯 智能推荐（主动推送相关知识）
- 📈 质量评分（记录用户反馈，优化匹配算法）
- 🌐 团队协作（多人标注和审核）

---

## 常见问题

### Q1：需要多少数据才能开始构建知识库？

**A：** 建议至少 20-30 条错误记录。但即使数据较少，也可以开始构建，随着数据增加，知识库会越来越准确。

### Q2：多久构建一次知识库？

**A：** 
- 初期：每周一次
- 稳定后：每月一次
- 也可以设置阈值：新增 20 条记录自动触发

### Q3：如何评估知识库的质量？

**A：** 关键指标：
- 匹配准确率（> 85%）
- 用户采纳率（> 70%）
- 修复时间缩短（> 50%）
- 重复错误减少（> 60%）

### Q4：向量数据库的成本如何？

**A：** 
- Pinecone：免费版支持 1M 向量
- 自建方案：Qdrant（开源，免费）
- 估算：1000条记录约 0.5M 向量

### Q5：如何处理敏感信息？

**A：** 
- 存储前脱敏（隐藏密码、密钥等）
- 控制访问权限
- 定期审计敏感数据

---

## 总结

### 核心要点

1. **自动化优先**：无需人工整理，AI 自动完成分类和聚合
2. **持续积累**：每次错误处理都是一次数据沉淀
3. **智能检索**：AI 理解语义，匹配最相关的解决方案
4. **持续增值**：数据越多，知识库越准确，价值越大

### 实施建议

- ✅ 从简单开始：Phase 1 可以立即启动
- ✅ 逐步增强：根据需求和资源推进到 Phase 3
- ✅ 持续优化：收集用户反馈，不断改进匹配算法

### 价值预期

| 时间节点 | 数据量 | 匹配率 | 新人效率提升 |
|---------|--------|--------|-------------|
| 1 个月 | 20 条 | 30% | 2 倍 |
| 3 个月 | 60 条 | 60% | 5 倍 |
| 6 个月 | 120 条 | 80% | 10 倍 |
| 12 个月 | 240 条 | 90%+ | 15 倍+ |

**知识库是会增值的数字资产！** 🚀
