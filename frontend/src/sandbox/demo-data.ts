/**
 * 沙盒演示数据 —— **任务类数据来自真实数据库导出**（不是手编样例）
 *
 * 数据来源：
 *   1. 任务/交付物/事件流 → 由 backend/scripts/export-sandbox-demo.mjs 从
 *      backend/data/workbench.db.ts 的 6 个真实案例导出（见脚本 CASE_IDS），位于 DATA-BEGIN/END 之间；
 *   2. 热点/知识库/聊天/统计 → 手写区（真实热点是实时的、知识库是用户私有资料，
 *      不适合直接公开，故用「结构真实、内容示意」方式呈现，界面功能与真实一致、数据已脱敏）。
 *
 * ⚠️ 数据区由脚本维护，不要手改（会被下次导出覆盖）；手写区在 DATA-END 之后，可自由编辑。
 */

/* <<<DATA-BEGIN>>> 以下数据由 export-sandbox-demo.mjs 自动生成 */

export const AGENTS = [
  {
    "id": "agent-copy",
    "name": "美美",
    "role": "文案",
    "model": "deepseek-flash"
  },
  {
    "id": "agent-design",
    "name": "平平",
    "role": "设计师",
    "model": "gpt-image-2.5-sunburst"
  },
  {
    "id": "agent-supervisor",
    "name": "波波",
    "role": "主管",
    "model": "gpt-6-luna"
  },
  {
    "id": "agent-assistant",
    "name": "依依",
    "role": "助理",
    "model": "deepseek-flash"
  }
];

export const WORKFLOWS = [
  {
    "id": "ecom-new-listing",
    "name": "电商新品上架"
  },
  {
    "id": "xhs-note",
    "name": "小红书种草笔记"
  }
];

export const TASKS = [
  {
    "id": 26,
    "title": "手机壳",
    "workflowId": "ecom-new-listing",
    "stage": "deliver",
    "column": "done",
    "ownerAgentId": "agent-supervisor",
    "description": "",
    "platform": "京东,天猫",
    "progress": 100,
    "stageNote": "已交付 · 已完成",
    "createdBy": "你",
    "createdAt": "2026-09-14T05:21:29.476Z",
    "archived": 0,
    "brief": null
  },
  {
    "id": 13,
    "title": "办公室即溶咖啡种草笔记",
    "workflowId": "xhs-note",
    "stage": "xhs-inner",
    "column": "awaiting",
    "ownerAgentId": "agent-supervisor",
    "description": "3 秒即溶、不酸涩；面向 18-30 上班族",
    "platform": "小红书",
    "progress": 100,
    "stageNote": "",
    "createdBy": "你",
    "createdAt": "2026-09-12T17:19:54.106Z",
    "archived": 0,
    "brief": null
  },
  {
    "id": 29,
    "title": "冬日暖手宝开箱",
    "workflowId": "xhs-note",
    "stage": "xhs-cover",
    "column": "awaiting",
    "ownerAgentId": "agent-copy",
    "description": "充电暖手宝，宿舍可用",
    "platform": "小红书",
    "progress": 20,
    "stageNote": "等待你处理 · 已等待不到 1 分钟",
    "createdBy": "你",
    "createdAt": "2026-09-14T08:07:09.723Z",
    "archived": 0,
    "brief": {
      "imageCount": 3,
      "audience": "学生党",
      "contentType": "种草安利"
    }
  },
  {
    "id": 8,
    "title": "轻磁 Pro 磁吸充电宝 新品上架",
    "workflowId": "ecom-new-listing",
    "stage": "main-image",
    "column": "awaiting",
    "ownerAgentId": "agent-design",
    "description": "写一份电商主图卖点文案和详情页大纲，突出便携与快充。规格参数请以知识库资料为准。",
    "platform": "天猫",
    "progress": 40,
    "stageNote": "等待你处理 · 已等待 1 天",
    "createdBy": "你",
    "createdAt": "2026-09-11T07:20:10.726Z",
    "archived": 0,
    "brief": null
  },
  {
    "id": 47,
    "title": "macbook pro",
    "workflowId": "ecom-new-listing",
    "stage": "deliver",
    "column": "done",
    "ownerAgentId": "agent-supervisor",
    "description": "",
    "platform": "京东",
    "progress": 100,
    "stageNote": "",
    "createdBy": "你",
    "createdAt": "2026-10-11T03:30:17.955Z",
    "archived": 0,
    "brief": null
  },
  {
    "id": 46,
    "title": "华米 T-REX 3 运动手表（电商上架验证）",
    "workflowId": "ecom-new-listing",
    "stage": "deliver",
    "column": "done",
    "ownerAgentId": "agent-supervisor",
    "description": "华米 Amazfit T-REX 3 户外运动智能手表：八角金属表圈、1.5 英寸 AMOLED 屏、双频 GPS、100 米防水、军规认证；黑色氟橡胶表带。",
    "platform": "天猫",
    "progress": 100,
    "stageNote": "",
    "createdBy": "你",
    "createdAt": "2026-10-11T03:00:50.968Z",
    "archived": 0,
    "brief": null
  },
  {
    "id": 44,
    "title": "华米 T-REX 3 运动手表",
    "workflowId": "xhs-note",
    "stage": "xhs-inner",
    "column": "done",
    "ownerAgentId": "agent-supervisor",
    "description": "华米 Amazfit T-REX 3 户外运动智能手表：八角金属表圈、1.5 英寸 AMOLED 屏、双频 GPS、100 米防水、军规认证；黑色氟橡胶表带。主打户外徒步与越野跑场景。",
    "platform": "小红书",
    "progress": 100,
    "stageNote": "",
    "createdBy": "你",
    "createdAt": "2026-10-11T02:15:40.338Z",
    "archived": 0,
    "brief": {
      "audience": "户外运动爱好者、徒步与越野跑人群",
      "contentType": "种草笔记",
      "product": "华米 T-REX 3 运动手表",
      "imageCount": 3
    }
  }
];

export const DELIVERABLES = {
  "8": [
    {
      "id": 27,
      "taskId": 8,
      "stage": "copy",
      "kind": "copy",
      "status": "approved",
      "version": 1,
      "updatedAt": "2026-09-11T07:20:48.338Z",
      "content": "{\"title\":\"轻磁 Pro 磁吸充电宝 10000mAh 22.5W 快充 15W 无线 198g 便携随行\",\"points\":[\"10000mAh/37Wh 容量，有线最高 22.5W 输出，手机、耳机等设备日常补电更高效。\",\"支持磁吸 15W 无线输出，靠近即吸附充电，通勤、差旅少带一根线。\",\"198g 轻量机身，104×68×16mm 薄型尺寸，口袋、小包轻松收纳，随行负担更小。\",\"USB-C 双向接口，支持双向充放电，一线兼顾给设备供电与为充电宝蓄能。\",\"锂聚合物电芯循环寿命 500 次以上，具备过充、过流、过温、短路四重保护，并通过 GB 31241 认证。\"],\"outline\":\"详情页按“便携快充痛点引入—容量与输出参数—磁吸无线体验—轻薄随行场景—安全认证与电芯—接口与双向使用—售后保障”的顺序展开，前段突出便携与快充，后段用规格和认证收束信任。\",\"keywords\":[\"磁吸充电宝\",\"10000mAh充电宝\",\"22.5W快充充电宝\",\"15W无线充电宝\",\"轻磁Pro\",\"便携充电宝\",\"USB-C双向充电宝\",\"天猫充电宝\"]}"
    },
    {
      "id": 34,
      "taskId": 8,
      "stage": "main-image",
      "kind": "image",
      "status": "pending",
      "version": 1,
      "updatedAt": "2026-09-11T11:22:55.438Z",
      "content": "[{\"id\":\"副图3\",\"name\":\"副图3\",\"kind\":\"sub\",\"url\":\"/demo/t8-main-image-1.jpg\",\"status\":\"pending\",\"attempts\":1},{\"id\":\"主图1\",\"name\":\"主图1\",\"kind\":\"main\",\"url\":\"/demo/t8-main-image-2.jpg\",\"status\":\"pending\",\"attempts\":1},{\"id\":\"副图2\",\"name\":\"副图2\",\"kind\":\"sub\",\"url\":\"/demo/t8-main-image-3.jpg\",\"status\":\"pending\",\"attempts\":1}]"
    }
  ],
  "13": [
    {
      "id": 42,
      "taskId": 13,
      "stage": "xhs-topic",
      "kind": "copy",
      "status": "approved",
      "version": 1,
      "updatedAt": "2026-09-12T17:20:12.404Z",
      "content": "{\"title\":\"选题方向\",\"points\":[\"场景痛点｜早八工位犯困，3秒冲开一杯不酸涩的续命咖啡\",\"成分实测｜实测溶解速度与酸涩度，3秒即溶口感真实记录\",\"平替对比｜对比楼下咖啡店与外卖，办公室即溶的性价比之选\"],\"outline\":\"\",\"keywords\":[\"#打工人早八续命\",\"#办公室咖啡\",\"#工位好物\"]}"
    },
    {
      "id": 43,
      "taskId": 13,
      "stage": "xhs-copy",
      "kind": "copy",
      "status": "approved",
      "version": 3,
      "updatedAt": "2026-09-12T17:27:26.053Z",
      "content": "{\"title\":\"办公室续命咖啡☕️3秒即溶不酸涩\",\"points\":[\"#办公室咖啡\",\"#即溶咖啡\",\"#打工人续命水\"],\"outline\":\"打工人早上真的离不开一杯咖啡☕️\\n这款即溶咖啡粉倒进水里搅两下就化开了，大概3秒搞定，不用等\\n喝起来口感顺滑，酸涩感比较轻，空口喝也舒服\\n放在工位抽屉里，开会前、下午犯困时来一杯刚刚好\\n18-30岁的上班族姐妹可以试试看～\",\"keywords\":[\"#办公室咖啡\",\"#即溶咖啡\",\"#打工人续命水\"]}"
    },
    {
      "id": 44,
      "taskId": 13,
      "stage": "xhs-inner",
      "kind": "image",
      "status": "approved",
      "version": 2,
      "updatedAt": "2026-09-12T17:36:44.479Z",
      "content": "[{\"id\":\"首图\",\"name\":\"首图\",\"kind\":\"main\",\"url\":\"\",\"status\":\"approved\",\"note\":\"This operation was aborted\",\"error\":\"This operation was aborted\",\"attempts\":3},{\"id\":\"内页图1\",\"name\":\"内页图1\",\"kind\":\"sub\",\"url\":\"/demo/t13-xhs-inner-2.jpg\",\"status\":\"approved\",\"attempts\":1},{\"id\":\"内页图2\",\"name\":\"内页图2\",\"kind\":\"sub\",\"url\":\"/demo/t13-xhs-inner-3.jpg\",\"status\":\"approved\",\"attempts\":1}]"
    },
    {
      "id": 45,
      "taskId": 13,
      "stage": "xhs-review",
      "kind": "copy",
      "status": "pending",
      "version": 4,
      "updatedAt": "2026-09-12T17:37:54.883Z",
      "content": "{\"title\":\"合规审核报告\",\"points\":[\"通过：绝对化/违禁用语\",\"通过：医疗功效宣称\"],\"outline\":\"整体合规，未见明显绝对化违禁用语或医疗功效宣称。\",\"keywords\":[]}"
    }
  ],
  "26": [
    {
      "id": 65,
      "taskId": 26,
      "stage": "copy",
      "kind": "copy",
      "status": "approved",
      "version": 1,
      "updatedAt": "2026-09-14T05:21:35.947Z",
      "content": "{\"title\":\"手机壳 京东自营同款 食品级接触材质 防摔抗黄 磨砂亲肤 全包镜头 5G信号无阻 多色可选\",\"points\":[\"食品级接触材质，通过GB 4806检测，贴身使用更安心\",\"四角气囊+加高镜头圈，1.2米六面防摔，日常磕碰不伤机\",\"磨砂亲肤涂层，抗指纹防手汗，久握不黏腻\",\"抗黄变配方，30天实测透亮如新，久用不发黄\",\"全包边精准开孔，按键手感清脆，无线充电无需摘壳\"],\"outline\":\"首图钩子（防摔+食品级）→ 场景痛点（通勤/手滑）→ 材质背书与防摔结构图 → 抗黄实测对比 → 亲肤手感与开孔细节 → 多色展示与适配机型 → 售后承诺（7天无理由，运费我们出）\",\"keywords\":[\"手机壳\",\"防摔手机壳\",\"抗黄手机壳\",\"磨砂手机壳\",\"食品级手机壳\",\"全包镜头手机壳\",\"亲肤手感手机壳\",\"京东手机壳\"]}"
    },
    {
      "id": 66,
      "taskId": 26,
      "stage": "copy",
      "kind": "provenance",
      "status": "pending",
      "version": 1,
      "updatedAt": "2026-09-14T05:21:35.955Z",
      "content": "{\"percent\":0,\"tracedCount\":0,\"untracedCount\":37,\"totalCount\":37,\"noFacts\":false,\"hasRefs\":false,\"refCount\":0,\"facts\":[{\"id\":\"f1\",\"type\":\"number-unit\",\"text\":\"5G\",\"field\":\"title\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":null,\"normalized\":\"5g\"},{\"id\":\"f2\",\"type\":\"textual\",\"text\":\"手机壳\",\"field\":\"title\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"手机壳\"},{\"id\":\"f3\",\"type\":\"textual\",\"text\":\"京东自营同款\",\"field\":\"title\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"京东自营同款\"},{\"id\":\"f4\",\"type\":\"textual\",\"text\":\"食品级接触材质\",\"field\":\"title\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"食品级接触材质\"},{\"id\":\"f5\",\"type\":\"textual\",\"text\":\"防摔抗黄\",\"field\":\"title\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"防摔抗黄\"},{\"id\":\"f6\",\"type\":\"textual\",\"text\":\"磨砂亲肤\",\"field\":\"title\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"磨砂亲肤\"},{\"id\":\"f7\",\"type\":\"textual\",\"text\":\"全包镜头\",\"field\":\"title\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"全包镜头\"},{\"id\":\"f8\",\"type\":\"textual\",\"text\":\"多色可选\",\"field\":\"title\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"多色可选\"},{\"id\":\"f9\",\"type\":\"certification\",\"text\":\"GB 4806\",\"field\":\"points\",\"index\":0,\"traced\":false,\"sources\":[],\"coverage\":null,\"normalized\":\"gb 4806\"},{\"id\":\"f10\",\"type\":\"textual\",\"text\":\"通过GB\",\"field\":\"points\",\"index\":0,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"通过gb\"},{\"id\":\"f11\",\"type\":\"textual\",\"text\":\"贴身使用更安心\",\"field\":\"points\",\"index\":0,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"贴身使用更安心\"},{\"id\":\"f12\",\"type\":\"textual\",\"text\":\"四角气囊+加高镜头圈\",\"field\":\"points\",\"index\":1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"四角气囊+加高镜头圈\"},{\"id\":\"f13\",\"type\":\"textual\",\"text\":\"日常磕碰不伤机\",\"field\":\"points\",\"index\":1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"日常磕碰不伤机\"},{\"id\":\"f14\",\"type\":\"textual\",\"text\":\"磨砂亲肤涂层\",\"field\":\"points\",\"index\":2,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"磨砂亲肤涂层\"},{\"id\":\"f15\",\"type\":\"textual\",\"text\":\"抗指纹防手汗\",\"field\":\"points\",\"index\":2,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"抗指纹防手汗\"},{\"id\":\"f16\",\"type\":\"textual\",\"text\":\"久握不黏腻\",\"field\":\"points\",\"index\":2,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"久握不黏腻\"},{\"id\":\"f17\",\"type\":\"number-unit\",\"text\":\"30天\",\"field\":\"points\",\"index\":3,\"traced\":false,\"sources\":[],\"coverage\":null,\"normalized\":\"30天\"},{\"id\":\"f18\",\"type\":\"textual\",\"text\":\"抗黄变配方\",\"field\":\"points\",\"index\":3,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"抗黄变配方\"},{\"id\":\"f19\",\"type\":\"textual\",\"text\":\"久用不发黄\",\"field\":\"points\",\"index\":3,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"久用不发黄\"},{\"id\":\"f20\",\"type\":\"textual\",\"text\":\"全包边精准开孔\",\"field\":\"points\",\"index\":4,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"全包边精准开孔\"},{\"id\":\"f21\",\"type\":\"textual\",\"text\":\"按键手感清脆\",\"field\":\"points\",\"index\":4,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"按键手感清脆\"},{\"id\":\"f22\",\"type\":\"textual\",\"text\":\"无线充电无需摘壳\",\"field\":\"points\",\"index\":4,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"无线充电无需摘壳\"},{\"id\":\"f23\",\"type\":\"number-unit\",\"text\":\"7天\",\"field\":\"outline\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":null,\"normalized\":\"7天\"},{\"id\":\"f24\",\"type\":\"textual\",\"text\":\"首图钩子（防摔+食品级）→\",\"field\":\"outline\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"首图钩子(防摔+食品级)→\"},{\"id\":\"f25\",\"type\":\"textual\",\"text\":\"场景痛点（通勤/手滑）→\",\"field\":\"outline\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"场景痛点(通勤/手滑)→\"},{\"id\":\"f26\",\"type\":\"textual\",\"text\":\"材质背书与防摔结构图\",\"field\":\"outline\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"材质背书与防摔结构图\"},{\"id\":\"f27\",\"type\":\"textual\",\"text\":\"抗黄实测对比\",\"field\":\"outline\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"抗黄实测对比\"},{\"id\":\"f28\",\"type\":\"textual\",\"text\":\"亲肤手感与开孔细节\",\"field\":\"outline\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"亲肤手感与开孔细节\"},{\"id\":\"f29\",\"type\":\"textual\",\"text\":\"多色展示与适配机型\",\"field\":\"outline\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"多色展示与适配机型\"},{\"id\":\"f30\",\"type\":\"textual\",\"text\":\"运费我们出）\",\"field\":\"outline\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"运费我们出)\"},{\"id\":\"f31\",\"type\":\"textual\",\"text\":\"防摔手机壳\",\"field\":\"keywords\",\"index\":1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"防摔手机壳\"},{\"id\":\"f32\",\"type\":\"textual\",\"text\":\"抗黄手机壳\",\"field\":\"keywords\",\"index\":2,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"抗黄手机壳\"},{\"id\":\"f33\",\"type\":\"textual\",\"text\":\"磨砂手机壳\",\"field\":\"keywords\",\"index\":3,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"磨砂手机壳\"},{\"id\":\"f34\",\"type\":\"textual\",\"text\":\"食品级手机壳\",\"field\":\"keywords\",\"index\":4,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"食品级手机壳\"},{\"id\":\"f35\",\"type\":\"textual\",\"text\":\"全包镜头手机壳\",\"field\":\"keywords\",\"index\":5,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"全包镜头手机壳\"},{\"id\":\"f36\",\"type\":\"textual\",\"text\":\"亲肤手感手机壳\",\"field\":\"keywords\",\"index\":6,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"亲肤手感手机壳\"},{\"id\":\"f37\",\"type\":\"textual\",\"text\":\"京东手机壳\",\"field\":\"keywords\",\"index\":7,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"京东手机壳\"}],\"refsMeta\":[],\"generatedAt\":\"2026-09-14T05:21:35.955Z\"}"
    },
    {
      "id": 67,
      "taskId": 26,
      "stage": "main-image",
      "kind": "image",
      "status": "approved",
      "version": 1,
      "updatedAt": "2026-09-14T05:22:43.349Z",
      "content": "[{\"id\":\"主图1\",\"name\":\"主图1\",\"kind\":\"main\",\"url\":\"/demo/t26-main-image-1.jpg\",\"status\":\"approved\",\"attempts\":1},{\"id\":\"副图3\",\"name\":\"副图3\",\"kind\":\"sub\",\"url\":\"/demo/t26-main-image-2.jpg\",\"status\":\"approved\",\"attempts\":1},{\"id\":\"副图2\",\"name\":\"副图2\",\"kind\":\"sub\",\"url\":\"/demo/t26-main-image-3.jpg\",\"status\":\"approved\",\"attempts\":1}]"
    },
    {
      "id": 68,
      "taskId": 26,
      "stage": "detail-image",
      "kind": "image",
      "status": "pending",
      "version": 1,
      "updatedAt": "2026-09-14T05:24:26.435Z",
      "content": "[{\"id\":\"卖点图\",\"name\":\"卖点图\",\"kind\":\"detail\",\"url\":\"/demo/t26-detail-image-1.jpg\",\"status\":\"pending\",\"attempts\":1},{\"id\":\"参数图\",\"name\":\"参数图\",\"kind\":\"detail\",\"url\":\"/demo/t26-detail-image-2.jpg\",\"status\":\"pending\",\"attempts\":1},{\"id\":\"场景图\",\"name\":\"场景图\",\"kind\":\"detail\",\"url\":\"/demo/t26-detail-image-3.jpg\",\"status\":\"pending\",\"attempts\":1},{\"id\":\"细节图\",\"name\":\"细节图\",\"kind\":\"detail\",\"url\":\"/demo/t26-detail-image-4.jpg\",\"status\":\"pending\",\"attempts\":1}]"
    },
    {
      "id": 69,
      "taskId": 26,
      "stage": "review",
      "kind": "copy",
      "status": "pending",
      "version": 1,
      "updatedAt": "2026-09-14T05:25:10.747Z",
      "content": "{\"title\":\"主管校对报告\",\"points\":[],\"outline\":\"视觉一致性校对（基准：上传参考图）：7 张图片与基准产品一致，无问题，准予放行。\",\"keywords\":[]}"
    },
    {
      "id": 70,
      "taskId": 26,
      "stage": "deliver",
      "kind": "copy",
      "status": "pending",
      "version": 1,
      "updatedAt": "2026-09-14T05:25:14.857Z",
      "content": "{\"title\":\"手机壳上架资料包\",\"points\":[\"商品标题\",\"搜索关键词\",\"五大核心卖点文案\",\"商品详情页文案\",\"主图\",\"详情图\",\"规格参数表\",\"质检校对报告\"],\"outline\":\"上架资料包已完成\",\"keywords\":[]}"
    }
  ],
  "29": [
    {
      "id": 79,
      "taskId": 29,
      "stage": "xhs-topic",
      "kind": "copy",
      "status": "approved",
      "version": 1,
      "updatedAt": "2026-09-14T08:07:10.260Z",
      "content": "{\"title\":\"选题方向\",\"points\":[\"场景痛点种草｜从「冬日暖手宝开箱」的高频使用场景切入痛点，情绪化表达\",\"成分/参数实测｜以实测口吻拆解核心参数与成分，理性说服\",\"平价替代对比｜对标同类大牌做平替对比，突出性价比\"],\"outline\":\"\",\"keywords\":[\"#好物分享\",\"#日常必备\"]}"
    },
    {
      "id": 80,
      "taskId": 29,
      "stage": "xhs-copy",
      "kind": "copy",
      "status": "pending",
      "version": 2,
      "updatedAt": "2026-09-14T09:13:04.929Z",
      "content": "{\"title\":\"冬日暖手宝开箱｜真实体验分享\",\"points\":[\"#好物分享\",\"#真实体验\",\"#日常必备\"],\"outline\":\"入手「冬日暖手宝开箱」有一段时间了，今天来交一份真实作业📝\\n\\n先说结论：日常使用真的顺手，细节处理比预期到位，这个价位能打成这样我觉得可以冲。\\n\\n✅ 使用感受：上手没有学习成本，开箱即用；做工在同类里算扎实的，没有廉价感。\\n✅ 日常体验：响应速度快，连续用下来也很稳，没有出现掉链子的情况。\\n⚠️ 小缺点：包装偏简单，送人自用建议自己配个收纳。\\n\\n💰 性价比方面，对比之前用过的几款，它属于「不花冤枉钱」的类型：核心体验都在，溢价不高。\\n\\n👩‍🎓 适合人群：学生党、租房党、想提升日常幸福感的上班族都合适；追求极致参数的硬核玩家可能会觉得普通。\\n\\n总结：如果你最近正好在犹豫要不要入手，我的建议是——预算够就冲，早买早享受；还在观望的可以先收藏，蹲一个好价再上车也不迟～\",\"keywords\":[\"#好物分享\",\"#真实体验\",\"#日常必备\"]}"
    },
    {
      "id": 81,
      "taskId": 29,
      "stage": "xhs-cover",
      "kind": "image",
      "status": "approved",
      "version": 3,
      "updatedAt": "2026-09-14T08:42:21.862Z",
      "content": "[{\"id\":\"首图\",\"name\":\"首图\",\"kind\":\"main\",\"url\":\"/demo/t29-xhs-cover-1.jpg\",\"status\":\"approved\",\"attempts\":1}]"
    },
    {
      "id": 87,
      "taskId": 29,
      "stage": "xhs-inner",
      "kind": "image",
      "status": "approved",
      "version": 1,
      "updatedAt": "2026-09-14T09:11:33.638Z",
      "content": "[{\"id\":\"内页图1\",\"name\":\"内页图1\",\"kind\":\"sub\",\"url\":\"/demo/t29-xhs-inner-1.jpg\",\"status\":\"approved\",\"attempts\":1},{\"id\":\"内页图2\",\"name\":\"内页图2\",\"kind\":\"sub\",\"url\":\"/demo/t29-xhs-inner-2.jpg\",\"status\":\"approved\",\"attempts\":1}]"
    },
    {
      "id": 90,
      "taskId": 29,
      "stage": "xhs-review",
      "kind": "copy",
      "status": "pending",
      "version": 1,
      "updatedAt": "2026-09-14T09:13:04.442Z",
      "content": "{\"title\":\"主管校对报告\",\"points\":[\"通过：配图与文案描述相符\",\"未通过：绝对化/违禁用语\",\"通过：医疗功效宣称\"],\"outline\":\"存在评论区导流风险，建议修改后发布。 视觉审核（比对图片与文案描述是否相符）：3 张一致。\",\"keywords\":[]}"
    }
  ],
  "44": [
    {
      "id": 125,
      "taskId": 44,
      "stage": "xhs-topic",
      "kind": "copy",
      "status": "approved",
      "version": 1,
      "updatedAt": "2026-10-11T02:15:55.098Z",
      "content": "{\"title\":\"选题方向\",\"points\":[\"户外实测场景｜徒步越野中双频GPS轨迹与100米防水实战表现\",\"硬核参数拆解｜八角金属表圈与军规认证的耐用性细节解读\",\"同价位对比｜与同级户外表在屏幕、防水、GPS上的差异盘点\"],\"outline\":\"\",\"keywords\":[\"#户外徒步\",\"#越野跑\",\"#运动手表实测\"]}"
    },
    {
      "id": 126,
      "taskId": 44,
      "stage": "xhs-copy",
      "kind": "copy",
      "status": "approved",
      "version": 1,
      "updatedAt": "2026-10-11T02:16:08.344Z",
      "content": "{\"title\":\"🏔️徒步党狂喜！华米T-REX 3真香\",\"points\":[\"#华米TREX3\",\"#户外运动手表\",\"#徒步装备\",\"#越野跑\",\"#运动手表推荐\"],\"outline\":\"谁懂啊！上周徒步失联3小时，就因为它…\\n\\n之前爬山总怕手表没电、GPS飘，这次带着华米T-REX 3走了一条野路，真的一整个安心住！\\n\\n✅ 先夸这块1.5英寸AMOLED屏，大太阳底下也看得清轨迹，抬腕就亮。八角金属表圈+黑色氟橡胶表带，硬核又耐造，树枝刮了几次一点痕迹没有。军规认证不是白给的，我这种手残党摔了两次，表盘完好。\\n\\n👉 双频GPS真的稳！之前用某牌手表在峡谷里轨迹直接画直线，这次全程跟实际路线几乎重合，误差小到可以忽略。100米防水，溪边洗手、暴雨都不用摘。续航我实测重度用5天还剩20%，徒步两天完全不带充电宝。\\n\\n💤 小缺点也说下：表有点分量，刚戴两天手腕会酸，习惯后还好；氟橡胶表带夏天出汗会有点闷，建议换个尼龙带。\\n\\n总之，户外徒步和越野跑想找块靠谱不贵的表，华米T-REX 3亲测值得。最近想入手的姐妹，记得先量下手腕围，选对表带尺寸更舒服～\",\"keywords\":[\"#华米TREX3\",\"#户外运动手表\",\"#徒步装备\",\"#越野跑\",\"#运动手表推荐\"]}"
    },
    {
      "id": 127,
      "taskId": 44,
      "stage": "xhs-cover",
      "kind": "image",
      "status": "approved",
      "version": 1,
      "updatedAt": "2026-10-11T02:16:42.819Z",
      "content": "[{\"id\":\"首图\",\"name\":\"首图\",\"kind\":\"main\",\"url\":\"/demo/t44-xhs-cover-1.jpg\",\"status\":\"approved\",\"attempts\":1}]"
    },
    {
      "id": 128,
      "taskId": 44,
      "stage": "xhs-inner",
      "kind": "image",
      "status": "approved",
      "version": 1,
      "updatedAt": "2026-10-11T02:18:26.784Z",
      "content": "[{\"id\":\"内页图1\",\"name\":\"内页图1\",\"kind\":\"sub\",\"url\":\"/demo/t44-xhs-inner-1.jpg\",\"status\":\"approved\",\"attempts\":2},{\"id\":\"内页图2\",\"name\":\"内页图2\",\"kind\":\"sub\",\"url\":\"/demo/t44-xhs-inner-2.jpg\",\"status\":\"approved\",\"attempts\":1}]"
    },
    {
      "id": 129,
      "taskId": 44,
      "stage": "xhs-review",
      "kind": "copy",
      "status": "approved",
      "version": 1,
      "updatedAt": "2026-10-11T02:19:26.291Z",
      "content": "{\"title\":\"主管校对报告\",\"points\":[\"通过：配图与参考图主体一致\",\"通过：无「最」「第一」等绝对化用语\",\"通过：功效描述无医疗宣称\"],\"outline\":\"合规检查通过：无绝对化用语、无医疗宣称。 视觉审核（以上传参考图为基准比对主体一致性）：2 张一致（1 张跳过）。\",\"keywords\":[]}"
    }
  ],
  "46": [
    {
      "id": 131,
      "taskId": 46,
      "stage": "copy",
      "kind": "copy",
      "status": "approved",
      "version": 2,
      "updatedAt": "2026-10-11T03:01:45.294Z",
      "content": "{\"title\":\"华米Amazfit T-REX 3 户外运动智能手表 双频GPS 100米防水 军规认证\",\"points\":[\"双频GPS精准定位：户外徒步、越野跑轨迹不飘移，复杂地形也能稳定记录每一步\",\"1.5英寸AMOLED高清屏：强光下依然清晰可读，抬腕即见配速、心率与导航信息\",\"100米防水+军规认证：游泳、溯溪、暴雨天放心佩戴，耐摔耐寒经得起户外折腾\",\"八角金属表圈+黑色氟橡胶表带：硬朗机能风设计，抗刮耐磨，运动通勤都百搭\",\"华米Amazfit品牌售后保障：支持7天无理由退换，具体质保政策以官方页面公示为准\"],\"outline\":\"首屏主图+核心卖点短句（双频GPS/100米防水/军规认证），第二屏八角金属表圈与AMOLED屏细节展示，第三屏双频GPS户外场景实测数据，第四屏100米防水与军规认证说明，第五屏黑色氟橡胶表带佩戴体验，第六屏参数规格表，第七屏售后与退换政策。\",\"keywords\":[\"华米Amazfit T-REX 3\",\"户外运动智能手表\",\"双频GPS手表\",\"100米防水手表\",\"军规认证智能手表\",\"AMOLED屏运动手表\",\"越野跑手表推荐\",\"黑色氟橡胶表带手表\"]}"
    },
    {
      "id": 132,
      "taskId": 46,
      "stage": "copy",
      "kind": "provenance",
      "status": "pending",
      "version": 2,
      "updatedAt": "2026-10-11T03:01:45.296Z",
      "content": "{\"percent\":0,\"tracedCount\":0,\"untracedCount\":24,\"totalCount\":24,\"noFacts\":false,\"hasRefs\":false,\"refCount\":0,\"facts\":[{\"id\":\"f1\",\"type\":\"textual\",\"text\":\"华米Amazfit\",\"field\":\"title\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"华米amazfit\"},{\"id\":\"f2\",\"type\":\"textual\",\"text\":\"T-REX\",\"field\":\"title\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"t-rex\"},{\"id\":\"f3\",\"type\":\"textual\",\"text\":\"户外运动智能手表\",\"field\":\"title\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"户外运动智能手表\"},{\"id\":\"f4\",\"type\":\"textual\",\"text\":\"双频GPS\",\"field\":\"title\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"双频gps\"},{\"id\":\"f5\",\"type\":\"textual\",\"text\":\"军规认证\",\"field\":\"title\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"军规认证\"},{\"id\":\"f6\",\"type\":\"textual\",\"text\":\"双频GPS精准定位：户外徒步、越野跑轨迹不飘移\",\"field\":\"points\",\"index\":0,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"双频gps精准定位:户外徒步、越野跑轨迹不飘移\"},{\"id\":\"f7\",\"type\":\"textual\",\"text\":\"复杂地形也能稳定记录每一步\",\"field\":\"points\",\"index\":0,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"复杂地形也能稳定记录每一步\"},{\"id\":\"f8\",\"type\":\"textual\",\"text\":\"抬腕即见配速、心率与导航信息\",\"field\":\"points\",\"index\":1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"抬腕即见配速、心率与导航信息\"},{\"id\":\"f9\",\"type\":\"textual\",\"text\":\"耐摔耐寒经得起户外折腾\",\"field\":\"points\",\"index\":2,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"耐摔耐寒经得起户外折腾\"},{\"id\":\"f10\",\"type\":\"textual\",\"text\":\"八角金属表圈+黑色氟橡胶表带：硬朗机能风设计\",\"field\":\"points\",\"index\":3,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"八角金属表圈+黑色氟橡胶表带:硬朗机能风设计\"},{\"id\":\"f11\",\"type\":\"textual\",\"text\":\"抗刮耐磨\",\"field\":\"points\",\"index\":3,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"抗刮耐磨\"},{\"id\":\"f12\",\"type\":\"textual\",\"text\":\"运动通勤都百搭\",\"field\":\"points\",\"index\":3,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"运动通勤都百搭\"},{\"id\":\"f13\",\"type\":\"number-unit\",\"text\":\"7天\",\"field\":\"points\",\"index\":4,\"traced\":false,\"sources\":[],\"coverage\":null,\"normalized\":\"7天\"},{\"id\":\"f14\",\"type\":\"textual\",\"text\":\"具体质保政策以官方页面公示为准\",\"field\":\"points\",\"index\":4,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"具体质保政策以官方页面公示为准\"},{\"id\":\"f15\",\"type\":\"textual\",\"text\":\"第二屏八角金属表圈与AMOLED屏细节展示\",\"field\":\"outline\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"第二屏八角金属表圈与amoled屏细节展示\"},{\"id\":\"f16\",\"type\":\"textual\",\"text\":\"第三屏双频GPS户外场景实测数据\",\"field\":\"outline\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"第三屏双频gps户外场景实测数据\"},{\"id\":\"f17\",\"type\":\"textual\",\"text\":\"第五屏黑色氟橡胶表带佩戴体验\",\"field\":\"outline\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"第五屏黑色氟橡胶表带佩戴体验\"},{\"id\":\"f18\",\"type\":\"textual\",\"text\":\"第六屏参数规格表\",\"field\":\"outline\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"第六屏参数规格表\"},{\"id\":\"f19\",\"type\":\"textual\",\"text\":\"第七屏售后与退换政策\",\"field\":\"outline\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"第七屏售后与退换政策\"},{\"id\":\"f20\",\"type\":\"textual\",\"text\":\"双频GPS手表\",\"field\":\"keywords\",\"index\":2,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"双频gps手表\"},{\"id\":\"f21\",\"type\":\"textual\",\"text\":\"军规认证智能手表\",\"field\":\"keywords\",\"index\":4,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"军规认证智能手表\"},{\"id\":\"f22\",\"type\":\"textual\",\"text\":\"AMOLED屏运动手表\",\"field\":\"keywords\",\"index\":5,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"amoled屏运动手表\"},{\"id\":\"f23\",\"type\":\"textual\",\"text\":\"越野跑手表推荐\",\"field\":\"keywords\",\"index\":6,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"越野跑手表推荐\"},{\"id\":\"f24\",\"type\":\"textual\",\"text\":\"黑色氟橡胶表带手表\",\"field\":\"keywords\",\"index\":7,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"黑色氟橡胶表带手表\"}],\"refsMeta\":[],\"generatedAt\":\"2026-10-11T03:01:45.296Z\"}"
    },
    {
      "id": 134,
      "taskId": 46,
      "stage": "main-image",
      "kind": "image",
      "status": "approved",
      "version": 2,
      "updatedAt": "2026-10-11T03:03:29.560Z",
      "content": "[{\"id\":\"主图1\",\"name\":\"主图1\",\"kind\":\"main\",\"url\":\"/demo/t46-main-image-1.jpg\",\"status\":\"approved\",\"attempts\":1},{\"id\":\"副图3\",\"name\":\"副图3\",\"kind\":\"sub\",\"url\":\"/demo/t46-main-image-2.jpg\",\"status\":\"approved\",\"attempts\":1},{\"id\":\"副图2\",\"name\":\"副图2\",\"kind\":\"sub\",\"url\":\"/demo/t46-main-image-3.jpg\",\"status\":\"approved\",\"attempts\":1}]"
    },
    {
      "id": 136,
      "taskId": 46,
      "stage": "detail-image",
      "kind": "image",
      "status": "approved",
      "version": 1,
      "updatedAt": "2026-10-11T03:04:58.491Z",
      "content": "[{\"id\":\"卖点图\",\"name\":\"卖点图\",\"kind\":\"detail\",\"url\":\"/demo/t46-detail-image-1.jpg\",\"status\":\"approved\",\"attempts\":1},{\"id\":\"参数图\",\"name\":\"参数图\",\"kind\":\"detail\",\"url\":\"/demo/t46-detail-image-2.jpg\",\"status\":\"approved\",\"attempts\":1},{\"id\":\"场景图\",\"name\":\"场景图\",\"kind\":\"detail\",\"url\":\"/demo/t46-detail-image-3.jpg\",\"status\":\"approved\",\"attempts\":1},{\"id\":\"细节图\",\"name\":\"细节图\",\"kind\":\"detail\",\"url\":\"/demo/t46-detail-image-4.jpg\",\"status\":\"approved\",\"attempts\":1}]"
    },
    {
      "id": 138,
      "taskId": 46,
      "stage": "review",
      "kind": "copy",
      "status": "pending",
      "version": 1,
      "updatedAt": "2026-10-11T03:07:55.159Z",
      "content": "{\"title\":\"主管校对报告\",\"points\":[\"通过：配图与参考图主体一致（7 张已核对）\",\"通过：绝对化/违禁用语（未提供具体文案或图片文字，未发现可引用的明确违规词；建议复核完整标题、卖点、主图及详情图文字。）\",\"通过：医疗功效宣称（未提供具体内容，未发现可引用的治疗、治愈、修复疾病或生理问题等表述；建议复核健康、运动监测相关描述。）\",\"通过：文案与图片信息一致（未提供文案、主图、详情图，无法核对型号、规格、卖点是否一致；建议补充全部产出后复核。）\"],\"outline\":\"视觉一致性校对（基准：上传参考图）：7 张图片与基准产品一致，无问题，准予放行。\",\"keywords\":[]}"
    },
    {
      "id": 139,
      "taskId": 46,
      "stage": "deliver",
      "kind": "copy",
      "status": "pending",
      "version": 1,
      "updatedAt": "2026-10-11T03:07:57.705Z",
      "content": "{\"title\":\"华米 T-REX 3 运动手表电商上架验证资料包\",\"points\":[\"商品标题与副标题文件\",\"核心关键词与搜索词清单\",\"商品卖点文案与详情页文案\",\"主图文件包\",\"详情图文件包\",\"规格参数与型号信息表\",\"图文一致性质检报告\",\"平台合规与上架验证清单\"],\"outline\":\"上架资料包已完成\",\"keywords\":[]}"
    }
  ],
  "47": [
    {
      "id": 140,
      "taskId": 47,
      "stage": "copy",
      "kind": "copy",
      "status": "approved",
      "version": 1,
      "updatedAt": "2026-10-11T03:30:24.905Z",
      "content": "{\"title\":\"MacBook Pro 京东自营 笔记本电脑 移动办公专业创作 正品保障\",\"points\":[\"强劲芯片性能：搭载 Apple M 系列芯片，统一内存架构，代码编译、视频渲染、多任务处理流畅响应，专业创作不等待。\",\"专业级屏幕素质：Liquid 视网膜 XDR 显示屏，高亮度与广色域覆盖，照片调色、视频剪辑所见即所得，户外强光下依然清晰。\",\"全天候续航与便携机身：一次充电满足全天移动办公需求，机身轻薄便于通勤携带，从会议室到咖啡厅随时进入工作状态。\",\"丰富接口与安全体验：配备雷雳端口、HDMI 与 SD 卡槽，外接显示器与相机存储卡即插即用；触控 ID 一键解锁与安全支付。\",\"京东自营正品保障：京东自营发货，支持 7 天无理由退货（符合平台规则），全国联保，售后响应及时，购机更安心。\"],\"outline\":\"首段复述主关键词「MacBook Pro 京东自营」并点明专业创作定位；中段按性能、屏幕、续航便携、接口安全、服务保障五段式展开，参数硬信息与场景引导分离排版；结尾列出规格参数表与京东自营服务说明，引导下单。\",\"keywords\":[\"MacBook Pro 京东自营\",\"苹果笔记本电脑 专业创作\",\"M 系列芯片 笔记本 移动办公\",\"Liquid 视网膜 XDR 笔记本\",\"长续航 轻薄 笔记本电脑\",\"视频剪辑 笔记本电脑 推荐\",\"京东自营 苹果电脑 正品保障\",\"雷雳接口 笔记本 外接显示器\"]}"
    },
    {
      "id": 141,
      "taskId": 47,
      "stage": "copy",
      "kind": "provenance",
      "status": "pending",
      "version": 1,
      "updatedAt": "2026-10-11T03:30:24.911Z",
      "content": "{\"percent\":0,\"tracedCount\":0,\"untracedCount\":54,\"totalCount\":54,\"noFacts\":false,\"hasRefs\":false,\"refCount\":0,\"facts\":[{\"id\":\"f1\",\"type\":\"textual\",\"text\":\"MacBook\",\"field\":\"title\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"macbook\"},{\"id\":\"f2\",\"type\":\"textual\",\"text\":\"Pro\",\"field\":\"title\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"pro\"},{\"id\":\"f3\",\"type\":\"textual\",\"text\":\"京东自营\",\"field\":\"title\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"京东自营\"},{\"id\":\"f4\",\"type\":\"textual\",\"text\":\"笔记本电脑\",\"field\":\"title\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"笔记本电脑\"},{\"id\":\"f5\",\"type\":\"textual\",\"text\":\"移动办公专业创作\",\"field\":\"title\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"移动办公专业创作\"},{\"id\":\"f6\",\"type\":\"textual\",\"text\":\"正品保障\",\"field\":\"title\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"正品保障\"},{\"id\":\"f7\",\"type\":\"textual\",\"text\":\"强劲芯片性能：搭载\",\"field\":\"points\",\"index\":0,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"强劲芯片性能:搭载\"},{\"id\":\"f8\",\"type\":\"textual\",\"text\":\"Apple\",\"field\":\"points\",\"index\":0,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"apple\"},{\"id\":\"f9\",\"type\":\"textual\",\"text\":\"系列芯片\",\"field\":\"points\",\"index\":0,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"系列芯片\"},{\"id\":\"f10\",\"type\":\"textual\",\"text\":\"统一内存架构\",\"field\":\"points\",\"index\":0,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"统一内存架构\"},{\"id\":\"f11\",\"type\":\"textual\",\"text\":\"代码编译、视频渲染、多任务处理流畅响应\",\"field\":\"points\",\"index\":0,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"代码编译、视频渲染、多任务处理流畅响应\"},{\"id\":\"f12\",\"type\":\"textual\",\"text\":\"专业创作不等待\",\"field\":\"points\",\"index\":0,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"专业创作不等待\"},{\"id\":\"f13\",\"type\":\"textual\",\"text\":\"专业级屏幕素质：Liquid\",\"field\":\"points\",\"index\":1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"专业级屏幕素质:liquid\"},{\"id\":\"f14\",\"type\":\"textual\",\"text\":\"视网膜\",\"field\":\"points\",\"index\":1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"视网膜\"},{\"id\":\"f15\",\"type\":\"textual\",\"text\":\"XDR\",\"field\":\"points\",\"index\":1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"xdr\"},{\"id\":\"f16\",\"type\":\"textual\",\"text\":\"显示屏\",\"field\":\"points\",\"index\":1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"显示屏\"},{\"id\":\"f17\",\"type\":\"textual\",\"text\":\"高亮度与广色域覆盖\",\"field\":\"points\",\"index\":1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"高亮度与广色域覆盖\"},{\"id\":\"f18\",\"type\":\"textual\",\"text\":\"照片调色、视频剪辑所见即所得\",\"field\":\"points\",\"index\":1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"照片调色、视频剪辑所见即所得\"},{\"id\":\"f19\",\"type\":\"textual\",\"text\":\"户外强光下依然清晰\",\"field\":\"points\",\"index\":1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"户外强光下依然清晰\"},{\"id\":\"f20\",\"type\":\"textual\",\"text\":\"全天候续航与便携机身：一次充电满足全天移动办公需求\",\"field\":\"points\",\"index\":2,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"全天候续航与便携机身:一次充电满足全天移动办公需求\"},{\"id\":\"f21\",\"type\":\"textual\",\"text\":\"机身轻薄便于通勤携带\",\"field\":\"points\",\"index\":2,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"机身轻薄便于通勤携带\"},{\"id\":\"f22\",\"type\":\"textual\",\"text\":\"从会议室到咖啡厅随时进入工作状态\",\"field\":\"points\",\"index\":2,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"从会议室到咖啡厅随时进入工作状态\"},{\"id\":\"f23\",\"type\":\"textual\",\"text\":\"丰富接口与安全体验：配备雷雳端口、HDMI\",\"field\":\"points\",\"index\":3,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"丰富接口与安全体验:配备雷雳端口、hdmi\"},{\"id\":\"f24\",\"type\":\"textual\",\"text\":\"SD\",\"field\":\"points\",\"index\":3,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"sd\"},{\"id\":\"f25\",\"type\":\"textual\",\"text\":\"卡槽\",\"field\":\"points\",\"index\":3,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"卡槽\"},{\"id\":\"f26\",\"type\":\"textual\",\"text\":\"外接显示器与相机存储卡即插即用\",\"field\":\"points\",\"index\":3,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"外接显示器与相机存储卡即插即用\"},{\"id\":\"f27\",\"type\":\"textual\",\"text\":\"触控\",\"field\":\"points\",\"index\":3,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"触控\"},{\"id\":\"f28\",\"type\":\"textual\",\"text\":\"ID\",\"field\":\"points\",\"index\":3,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"id\"},{\"id\":\"f29\",\"type\":\"textual\",\"text\":\"一键解锁与安全支付\",\"field\":\"points\",\"index\":3,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"一键解锁与安全支付\"},{\"id\":\"f30\",\"type\":\"number-unit\",\"text\":\"7 天\",\"field\":\"points\",\"index\":4,\"traced\":false,\"sources\":[],\"coverage\":null,\"normalized\":\"7天\"},{\"id\":\"f31\",\"type\":\"textual\",\"text\":\"京东自营正品保障：京东自营发货\",\"field\":\"points\",\"index\":4,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"京东自营正品保障:京东自营发货\"},{\"id\":\"f32\",\"type\":\"textual\",\"text\":\"支持\",\"field\":\"points\",\"index\":4,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"支持\"},{\"id\":\"f33\",\"type\":\"textual\",\"text\":\"天无理由退货（符合平台规则）\",\"field\":\"points\",\"index\":4,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"天无理由退货(符合平台规则)\"},{\"id\":\"f34\",\"type\":\"textual\",\"text\":\"全国联保\",\"field\":\"points\",\"index\":4,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"全国联保\"},{\"id\":\"f35\",\"type\":\"textual\",\"text\":\"售后响应及时\",\"field\":\"points\",\"index\":4,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"售后响应及时\"},{\"id\":\"f36\",\"type\":\"textual\",\"text\":\"购机更安心\",\"field\":\"points\",\"index\":4,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"购机更安心\"},{\"id\":\"f37\",\"type\":\"textual\",\"text\":\"首段复述主关键词「MacBook\",\"field\":\"outline\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"首段复述主关键词「macbook\"},{\"id\":\"f38\",\"type\":\"textual\",\"text\":\"京东自营」并点明专业创作定位\",\"field\":\"outline\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"京东自营」并点明专业创作定位\"},{\"id\":\"f39\",\"type\":\"textual\",\"text\":\"中段按性能、屏幕、续航便携、接口安全、服务保障五段式展开\",\"field\":\"outline\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"中段按性能、屏幕、续航便携、接口安全、服务保障五段式展开\"},{\"id\":\"f40\",\"type\":\"textual\",\"text\":\"参数硬信息与场景引导分离排版\",\"field\":\"outline\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"参数硬信息与场景引导分离排版\"},{\"id\":\"f41\",\"type\":\"textual\",\"text\":\"结尾列出规格参数表与京东自营服务说明\",\"field\":\"outline\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"结尾列出规格参数表与京东自营服务说明\"},{\"id\":\"f42\",\"type\":\"textual\",\"text\":\"引导下单\",\"field\":\"outline\",\"index\":-1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"引导下单\"},{\"id\":\"f43\",\"type\":\"textual\",\"text\":\"苹果笔记本电脑\",\"field\":\"keywords\",\"index\":1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"苹果笔记本电脑\"},{\"id\":\"f44\",\"type\":\"textual\",\"text\":\"专业创作\",\"field\":\"keywords\",\"index\":1,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"专业创作\"},{\"id\":\"f45\",\"type\":\"textual\",\"text\":\"笔记本\",\"field\":\"keywords\",\"index\":2,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"笔记本\"},{\"id\":\"f46\",\"type\":\"textual\",\"text\":\"移动办公\",\"field\":\"keywords\",\"index\":2,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"移动办公\"},{\"id\":\"f47\",\"type\":\"textual\",\"text\":\"Liquid\",\"field\":\"keywords\",\"index\":3,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"liquid\"},{\"id\":\"f48\",\"type\":\"textual\",\"text\":\"长续航\",\"field\":\"keywords\",\"index\":4,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"长续航\"},{\"id\":\"f49\",\"type\":\"textual\",\"text\":\"轻薄\",\"field\":\"keywords\",\"index\":4,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"轻薄\"},{\"id\":\"f50\",\"type\":\"textual\",\"text\":\"视频剪辑\",\"field\":\"keywords\",\"index\":5,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"视频剪辑\"},{\"id\":\"f51\",\"type\":\"textual\",\"text\":\"推荐\",\"field\":\"keywords\",\"index\":5,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"推荐\"},{\"id\":\"f52\",\"type\":\"textual\",\"text\":\"苹果电脑\",\"field\":\"keywords\",\"index\":6,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"苹果电脑\"},{\"id\":\"f53\",\"type\":\"textual\",\"text\":\"雷雳接口\",\"field\":\"keywords\",\"index\":7,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"雷雳接口\"},{\"id\":\"f54\",\"type\":\"textual\",\"text\":\"外接显示器\",\"field\":\"keywords\",\"index\":7,\"traced\":false,\"sources\":[],\"coverage\":0,\"normalized\":\"外接显示器\"}],\"refsMeta\":[],\"generatedAt\":\"2026-10-11T03:30:24.911Z\"}"
    },
    {
      "id": 144,
      "taskId": 47,
      "stage": "main-image",
      "kind": "image",
      "status": "approved",
      "version": 1,
      "updatedAt": "2026-10-11T03:31:56.053Z",
      "content": "[{\"id\":\"主图1\",\"name\":\"主图1\",\"kind\":\"main\",\"url\":\"/demo/t47-main-image-1.jpg\",\"status\":\"approved\",\"attempts\":1},{\"id\":\"副图3\",\"name\":\"副图3\",\"kind\":\"sub\",\"url\":\"/demo/t47-main-image-2.jpg\",\"status\":\"approved\",\"attempts\":1},{\"id\":\"副图2\",\"name\":\"副图2\",\"kind\":\"sub\",\"url\":\"/demo/t47-main-image-3.jpg\",\"status\":\"approved\",\"attempts\":1}]"
    },
    {
      "id": 146,
      "taskId": 47,
      "stage": "detail-image",
      "kind": "image",
      "status": "approved",
      "version": 1,
      "updatedAt": "2026-10-11T03:33:22.159Z",
      "content": "[{\"id\":\"卖点图\",\"name\":\"卖点图\",\"kind\":\"detail\",\"url\":\"/demo/t47-detail-image-1.jpg\",\"status\":\"approved\",\"attempts\":1},{\"id\":\"参数图\",\"name\":\"参数图\",\"kind\":\"detail\",\"url\":\"/demo/t47-detail-image-2.jpg\",\"status\":\"approved\",\"attempts\":1},{\"id\":\"细节图\",\"name\":\"细节图\",\"kind\":\"detail\",\"url\":\"/demo/t47-detail-image-3.jpg\",\"status\":\"approved\",\"attempts\":1},{\"id\":\"场景图\",\"name\":\"场景图\",\"kind\":\"detail\",\"url\":\"/demo/t47-detail-image-4.jpg\",\"status\":\"approved\",\"attempts\":1}]"
    },
    {
      "id": 147,
      "taskId": 47,
      "stage": "review",
      "kind": "copy",
      "status": "pending",
      "version": 1,
      "updatedAt": "2026-10-11T03:35:40.605Z",
      "content": "{\"title\":\"主管校对报告\",\"points\":[\"通过：配图与参考图主体一致（4 张已核对，3 张检查失败已跳过）\",\"通过：绝对化/违禁用语（未发现“最、第一、顶级、国家级”等明确绝对化或广告法违禁用语；“正品保障”“专业级屏幕素质”等为常见商品与服务描述，建议保留可验证依据。）\",\"通过：医疗功效宣称（未发现治疗、治愈、修复疾病或生理问题等医疗功效宣称；内容均为电脑性能、显示、续航、接口及售后服务描述。）\",\"通过：文案与图片信息一致（当前未发现图文矛盾表述；建议图片侧同步核对“Apple M 系列芯片”“Liquid 视网膜 XDR 显示屏”“雷雳端口、HDMI、SD 卡槽”“7 天无理由退货、全国联保”等信息。）\"],\"outline\":\"视觉一致性校对（基准：上传参考图）：4 张图片与基准产品一致（3 张检查失败已跳过），无问题，准予放行。\",\"keywords\":[]}"
    },
    {
      "id": 148,
      "taskId": 47,
      "stage": "deliver",
      "kind": "copy",
      "status": "pending",
      "version": 1,
      "updatedAt": "2026-10-11T03:35:56.337Z",
      "content": "{\"title\":\"MacBook Pro电商上架资料包\",\"points\":[\"商品标题\",\"关键词清单\",\"五点卖点文案\",\"商品详情页文案\",\"主图组\",\"详情图组\",\"规格参数表\",\"平台合规质检报告\"],\"outline\":\"上架资料包已完成\",\"keywords\":[]}"
    }
  ]
};

export const TASK_EVENTS = {
  "8": [
    {
      "id": 147,
      "type": "TASK_CREATED",
      "actor": "",
      "text": "",
      "at": "2026-09-11T07:20:10.726Z"
    },
    {
      "id": 148,
      "type": "TASK_CONFIRMED",
      "actor": "",
      "text": "",
      "at": "2026-09-11T07:20:43.989Z"
    },
    {
      "id": 149,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-09-11T07:20:45.496Z"
    },
    {
      "id": 150,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-09-11T07:20:45.497Z"
    },
    {
      "id": 151,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-09-11T07:20:48.340Z"
    },
    {
      "id": 174,
      "type": "APPROVED",
      "actor": "",
      "text": "",
      "at": "2026-09-11T11:21:12.457Z"
    },
    {
      "id": 175,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-09-11T11:21:12.458Z"
    },
    {
      "id": 176,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-09-11T11:21:45.886Z"
    },
    {
      "id": 177,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-09-11T11:22:26.042Z"
    },
    {
      "id": 178,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-09-11T11:22:55.433Z"
    },
    {
      "id": 179,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-09-11T11:22:55.655Z"
    }
  ],
  "13": [
    {
      "id": 211,
      "type": "TASK_CREATED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:19:54.106Z"
    },
    {
      "id": 212,
      "type": "TASK_CONFIRMED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:20:10.938Z"
    },
    {
      "id": 213,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:20:12.406Z"
    },
    {
      "id": 214,
      "type": "APPROVED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:20:21.574Z"
    },
    {
      "id": 215,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:20:21.574Z"
    },
    {
      "id": 216,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:20:23.051Z"
    },
    {
      "id": 217,
      "type": "APPROVED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:20:33.512Z"
    },
    {
      "id": 218,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:20:33.512Z"
    },
    {
      "id": 219,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:22:07.257Z"
    },
    {
      "id": 220,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:23:59.173Z"
    },
    {
      "id": 221,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:26:00.810Z"
    },
    {
      "id": 222,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:26:01.096Z"
    },
    {
      "id": 223,
      "type": "APPROVED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:26:46.201Z"
    },
    {
      "id": 224,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:26:46.201Z"
    },
    {
      "id": 225,
      "type": "REVIEW_ROLLBACK",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:27:03.703Z"
    },
    {
      "id": 226,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:27:04.883Z"
    },
    {
      "id": 227,
      "type": "REJECTED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:27:24.988Z"
    },
    {
      "id": 228,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:27:26.055Z"
    },
    {
      "id": 229,
      "type": "APPROVED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:30:46.041Z"
    },
    {
      "id": 230,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:30:46.042Z"
    },
    {
      "id": 231,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:33:46.055Z"
    },
    {
      "id": 232,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:35:34.081Z"
    },
    {
      "id": 233,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:36:44.470Z"
    },
    {
      "id": 234,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:36:44.632Z"
    },
    {
      "id": 235,
      "type": "APPROVED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:37:16.642Z"
    },
    {
      "id": 236,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:37:16.643Z"
    },
    {
      "id": 237,
      "type": "REVIEW_ROLLBACK",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:37:26.225Z"
    },
    {
      "id": 238,
      "type": "APPROVED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:37:26.228Z"
    },
    {
      "id": 239,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:37:26.229Z"
    },
    {
      "id": 240,
      "type": "APPROVED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:37:26.230Z"
    },
    {
      "id": 241,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:37:26.231Z"
    },
    {
      "id": 242,
      "type": "REVIEW_ROLLBACK",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:37:47.626Z"
    },
    {
      "id": 243,
      "type": "APPROVED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:37:47.628Z"
    },
    {
      "id": 244,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:37:47.628Z"
    },
    {
      "id": 245,
      "type": "APPROVED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:37:47.630Z"
    },
    {
      "id": 246,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:37:47.631Z"
    },
    {
      "id": 247,
      "type": "REVIEW_PASSED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:37:54.884Z"
    },
    {
      "id": 248,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:37:54.884Z"
    },
    {
      "id": 249,
      "type": "APPROVED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:37:54.885Z"
    },
    {
      "id": 250,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:37:54.885Z"
    },
    {
      "id": 251,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-09-12T17:37:54.888Z"
    }
  ],
  "26": [
    {
      "id": 337,
      "type": "TASK_CREATED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T05:21:29.476Z"
    },
    {
      "id": 338,
      "type": "TASK_CONFIRMED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T05:21:31.823Z"
    },
    {
      "id": 339,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T05:21:33.494Z"
    },
    {
      "id": 340,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T05:21:33.496Z"
    },
    {
      "id": 341,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T05:21:35.958Z"
    },
    {
      "id": 342,
      "type": "APPROVED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T05:21:42.942Z"
    },
    {
      "id": 343,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T05:21:42.943Z"
    },
    {
      "id": 344,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-09-14T05:22:09.679Z"
    },
    {
      "id": 345,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-09-14T05:22:09.864Z"
    },
    {
      "id": 346,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-09-14T05:22:43.341Z"
    },
    {
      "id": 347,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T05:22:43.742Z"
    },
    {
      "id": 348,
      "type": "APPROVED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T05:23:16.592Z"
    },
    {
      "id": 349,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T05:23:16.593Z"
    },
    {
      "id": 350,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-09-14T05:23:49.367Z"
    },
    {
      "id": 351,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-09-14T05:23:49.687Z"
    },
    {
      "id": 352,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-09-14T05:24:24.187Z"
    },
    {
      "id": 353,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-09-14T05:24:26.400Z"
    },
    {
      "id": 354,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T05:24:27.566Z"
    },
    {
      "id": 355,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T05:24:27.567Z"
    },
    {
      "id": 356,
      "type": "REVIEW_PASSED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T05:25:10.751Z"
    },
    {
      "id": 357,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T05:25:10.752Z"
    },
    {
      "id": 358,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T05:25:14.860Z"
    }
  ],
  "29": [
    {
      "id": 406,
      "type": "TASK_CREATED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T08:07:09.723Z"
    },
    {
      "id": 407,
      "type": "TASK_CONFIRMED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T08:07:09.741Z"
    },
    {
      "id": 408,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T08:07:10.262Z"
    },
    {
      "id": 409,
      "type": "APPROVED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T08:17:06.149Z"
    },
    {
      "id": 410,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T08:17:06.152Z"
    },
    {
      "id": 411,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T08:17:06.714Z"
    },
    {
      "id": 412,
      "type": "APPROVED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T08:17:15.510Z"
    },
    {
      "id": 413,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T08:17:15.512Z"
    },
    {
      "id": 416,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-09-14T08:17:45.544Z"
    },
    {
      "id": 417,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T08:17:45.594Z"
    },
    {
      "id": 426,
      "type": "REJECTED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T08:19:31.526Z"
    },
    {
      "id": 430,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-09-14T08:20:01.541Z"
    },
    {
      "id": 431,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T08:20:01.579Z"
    },
    {
      "id": 432,
      "type": "REJECTED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T08:41:48.343Z"
    },
    {
      "id": 433,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-09-14T08:42:21.826Z"
    },
    {
      "id": 434,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T08:42:22.187Z"
    },
    {
      "id": 445,
      "type": "APPROVED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T09:10:33.253Z"
    },
    {
      "id": 446,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T09:10:33.254Z"
    },
    {
      "id": 447,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-09-14T09:11:06.358Z"
    },
    {
      "id": 448,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-09-14T09:11:33.601Z"
    },
    {
      "id": 449,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T09:11:34.027Z"
    },
    {
      "id": 450,
      "type": "APPROVED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T09:12:31.459Z"
    },
    {
      "id": 451,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T09:12:31.460Z"
    },
    {
      "id": 458,
      "type": "REVIEW_ROLLBACK",
      "actor": "",
      "text": "",
      "at": "2026-09-14T09:13:04.447Z"
    },
    {
      "id": 459,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-09-14T09:13:04.934Z"
    }
  ],
  "44": [
    {
      "id": 593,
      "type": "TASK_CREATED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T02:15:40.338Z"
    },
    {
      "id": 594,
      "type": "TASK_CONFIRMED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T02:15:53.983Z"
    },
    {
      "id": 595,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T02:15:55.102Z"
    },
    {
      "id": 596,
      "type": "APPROVED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T02:16:05.057Z"
    },
    {
      "id": 597,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T02:16:05.057Z"
    },
    {
      "id": 598,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T02:16:08.346Z"
    },
    {
      "id": 599,
      "type": "APPROVED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T02:16:18.831Z"
    },
    {
      "id": 600,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T02:16:18.831Z"
    },
    {
      "id": 601,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-10-11T02:16:42.804Z"
    },
    {
      "id": 602,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T02:16:42.827Z"
    },
    {
      "id": 603,
      "type": "APPROVED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T02:17:05.858Z"
    },
    {
      "id": 604,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T02:17:05.858Z"
    },
    {
      "id": 605,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-10-11T02:17:47.048Z"
    },
    {
      "id": 606,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-10-11T02:18:26.767Z"
    },
    {
      "id": 607,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T02:18:26.788Z"
    },
    {
      "id": 608,
      "type": "APPROVED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T02:18:50.928Z"
    },
    {
      "id": 609,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T02:18:50.928Z"
    },
    {
      "id": 610,
      "type": "REVIEW_PASSED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T02:19:26.293Z"
    },
    {
      "id": 611,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T02:19:26.293Z"
    },
    {
      "id": 612,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T02:19:26.297Z"
    }
  ],
  "46": [
    {
      "id": 616,
      "type": "TASK_CREATED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:00:50.968Z"
    },
    {
      "id": 617,
      "type": "TASK_CONFIRMED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:00:59.388Z"
    },
    {
      "id": 618,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:01:00.840Z"
    },
    {
      "id": 619,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:01:00.841Z"
    },
    {
      "id": 620,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:01:03.401Z"
    },
    {
      "id": 621,
      "type": "APPROVED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:01:11.892Z"
    },
    {
      "id": 622,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:01:11.892Z"
    },
    {
      "id": 623,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:01:39.316Z"
    },
    {
      "id": 624,
      "type": "TASK_CONFIRMED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:01:41.457Z"
    },
    {
      "id": 625,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:01:41.507Z"
    },
    {
      "id": 626,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:01:42.915Z"
    },
    {
      "id": 627,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:01:42.915Z"
    },
    {
      "id": 628,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:01:45.297Z"
    },
    {
      "id": 634,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:02:05.448Z"
    },
    {
      "id": 637,
      "type": "APPROVED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:02:33.701Z"
    },
    {
      "id": 638,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:02:33.701Z"
    },
    {
      "id": 639,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:02:56.697Z"
    },
    {
      "id": 640,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:02:58.799Z"
    },
    {
      "id": 643,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:03:29.540Z"
    },
    {
      "id": 644,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:03:29.564Z"
    },
    {
      "id": 645,
      "type": "APPROVED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:03:39.364Z"
    },
    {
      "id": 646,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:03:39.364Z"
    },
    {
      "id": 648,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:04:10.028Z"
    },
    {
      "id": 649,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:04:10.989Z"
    },
    {
      "id": 651,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:04:45.591Z"
    },
    {
      "id": 652,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:04:58.422Z"
    },
    {
      "id": 653,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:04:58.498Z"
    },
    {
      "id": 654,
      "type": "APPROVED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:05:07.989Z"
    },
    {
      "id": 655,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:05:07.989Z"
    },
    {
      "id": 658,
      "type": "REVIEW_PASSED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:07:55.162Z"
    },
    {
      "id": 659,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:07:55.164Z"
    },
    {
      "id": 660,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:07:57.707Z"
    }
  ],
  "47": [
    {
      "id": 661,
      "type": "TASK_CREATED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:30:17.956Z"
    },
    {
      "id": 662,
      "type": "TASK_CONFIRMED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:30:20.809Z"
    },
    {
      "id": 663,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:30:22.249Z"
    },
    {
      "id": 664,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:30:22.250Z"
    },
    {
      "id": 665,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:30:24.913Z"
    },
    {
      "id": 671,
      "type": "APPROVED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:31:12.320Z"
    },
    {
      "id": 672,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:31:12.321Z"
    },
    {
      "id": 673,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:31:31.451Z"
    },
    {
      "id": 676,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:31:41.092Z"
    },
    {
      "id": 682,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:31:56.032Z"
    },
    {
      "id": 683,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:31:56.058Z"
    },
    {
      "id": 684,
      "type": "APPROVED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:31:59.647Z"
    },
    {
      "id": 685,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:31:59.647Z"
    },
    {
      "id": 686,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:32:37.394Z"
    },
    {
      "id": 687,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:32:50.643Z"
    },
    {
      "id": 690,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:33:14.168Z"
    },
    {
      "id": 691,
      "type": "SUB_TASK_COMPLETE",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:33:22.139Z"
    },
    {
      "id": 692,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:33:22.163Z"
    },
    {
      "id": 694,
      "type": "APPROVED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:34:10.649Z"
    },
    {
      "id": 695,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:34:10.650Z"
    },
    {
      "id": 701,
      "type": "REVIEW_PASSED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:35:40.607Z"
    },
    {
      "id": 702,
      "type": "STAGE_STARTED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:35:40.607Z"
    },
    {
      "id": 703,
      "type": "STAGE_COMPLETED",
      "actor": "",
      "text": "",
      "at": "2026-10-11T03:35:56.338Z"
    }
  ]
};

/* <<<DATA-END>>> */








/* ==========================================================================
   以下为「非任务类」演示数据（热点 / 知识库 / 聊天 / 统计）
   这些内容**不是**从数据库导出的，而是按真实界面结构整理的演示素材：
   真实数据库里的热点是实时的、知识库是用户私有资料，不适合直接公开到作品集，
   故此处用「结构真实、内容示意」的方式呈现——界面功能与真实一致，数据已脱敏。
   ========================================================================== */

/** 阶段中文名（与 docs/规范/02_工作流阶段定义 一致） */
export const STAGE_LABELS = {
  requirement: '需求拆解',
  copy: '卖点文案',
  'main-image': '主图设计',
  'detail-image': '详情图设计',
  review: '主管校对',
  deliver: '交付归档',
  'xhs-topic': '选题方向',
  'xhs-copy': '笔记文案',
  'xhs-cover': '首图设计',
  'xhs-inner': '内页配图',
  'xhs-review': '合规审核',
  'xhs-deliver': '发布包装',
};

/** 知识库统计（结构与后端 GET /api/knowledge/stats 一致） */
export const KNOWLEDGE_STATS = {
  docCount: 22, tagCount: 19, dirCount: 11, edgeCount: 28,
  recent: [
    { path: '知识库/品牌规范/品牌视觉规范.md', title: '品牌视觉规范', dir: '知识库/品牌规范', tags: ['品牌', '视觉'], mtime: '2026-10-10T08:00:00.000Z', size: 1544 },
    { path: '知识库/品牌规范/品牌手册.md', title: '品牌手册', dir: '知识库/品牌规范', tags: ['品牌'], mtime: '2026-10-10T08:00:00.000Z', size: 3200 },
    { path: '技能库/小红书/小红书合规违禁词清单.md', title: '小红书合规违禁词清单', dir: '技能库/小红书', tags: ['合规'], mtime: '2026-10-09T03:00:00.000Z', size: 5600 },
    { path: '技能库/电商/电商文案模板.md', title: '电商文案模板', dir: '技能库/电商', tags: ['文案'], mtime: '2026-10-09T03:00:00.000Z', size: 1771 },
    { path: '知识库/文案素材/爆款标题库.md', title: '爆款标题库', dir: '知识库/文案素材', tags: ['文案'], mtime: '2026-10-12T06:00:00.000Z', size: 2100 },
  ],
  indexedAt: '2026-10-17T03:00:00.000Z', indexing: false, lastError: null,
};

export const KNOWLEDGE_DIRS = [
  { dir: '', count: 22 },
  { dir: '知识库', count: 13 },
  { dir: '知识库/品牌规范', count: 5 },
  { dir: '知识库/文案素材', count: 4 },
  { dir: '知识库/灵感库', count: 2 },
  { dir: '技能库', count: 7 },
  { dir: '技能库/小红书', count: 3 },
  { dir: '技能库/电商', count: 3 },
  { dir: '主题', count: 1 },
];

/** 每日热点面板（结构与后端 GET /api/hot 一致；8 条含 AI 三分组标签） */
export const HOT_PANEL = {
  generatedAt: '2026-10-17T03:00:00.000Z',
  displaySet: [
    { id: 'hot-1', title: '秋冬"围炉煮茶"搜索量环比涨 240%', summary: '站内"围炉煮茶"相关笔记近 7 天互动量破百万，露营装备、陶瓷茶具、炭炉成热销三件套。', source: '小红书热搜', sourceId: 'xhs-trend', url: 'https://www.xiaohongshu.com/explore/trend-1' },
    { id: 'hot-2', title: '工位改造话题持续升温，桌面收纳成刚需', summary: '"工位改造"标签下笔记数突破 12 万篇，桌面理线器、显示器支架、氛围灯是出现频次最高单品。', source: '小红书热搜', sourceId: 'xhs-trend', url: 'https://www.xiaohongshu.com/explore/trend-2' },
    { id: 'hot-3', title: '磁吸充电宝进入价格战，200 元档成主战场', summary: '主流品牌 10000mAh 磁吸充电宝价格下探至 199 元，快充功率与重量成为核心竞争点。', source: '电商派快讯', sourceId: 'pai-news', url: 'https://example.com/news-3' },
    { id: 'hot-4', title: '可视空气炸锅销量同比翻倍', summary: '带可视窗口的空气炸锅 2026 年 Q3 销量同比增长 118%，租房场景占比超六成。', source: '网经社 24h 播报', sourceId: '100ec-24h', url: 'https://example.com/news-4' },
    { id: 'hot-5', title: '液态硅胶手机壳因"不发黄"重回热销榜', summary: '用户评价关键词从"手感"转向"耐用度"，不发黄成为复购首要因素。', source: '电商派快讯', sourceId: 'pai-news', url: 'https://example.com/news-5' },
    { id: 'hot-6', title: '石墨烯发热产品科普内容需求上升', summary: '冬季临近，石墨烯发热围巾、暖手宝的"原理科普"类内容互动率显著高于纯种草内容。', source: '百度实时热点', sourceId: 'baidu-hot', url: 'https://example.com/news-6' },
    { id: 'hot-7', title: '双十一预售开启，服饰品类预售额同比增 32%', summary: '美妆与运动户外预售表现突出，内容平台种草转化链路成为品牌重点投入方向。', source: '网经社 24h 播报', sourceId: '100ec-24h', url: 'https://example.com/news-7' },
    { id: 'hot-8', title: '办公室咖啡消费增长，即溶与冻干成增速最快细分', summary: '一线城市写字楼周边即溶咖啡销量同比增长 45%，"3 点提神"是最高频消费场景。', source: '电商派快讯', sourceId: 'pai-news', url: 'https://example.com/news-8' },
  ],
  hiddenCount: 12, rawCount: 20, aiTagged: true, aiDegraded: false,
  aiTags: {
    'hot-1': { cls: 'dir', tag: '露营/茶具', use: '可做"围炉煮茶装备清单"，直接对应户外品类选品' },
    'hot-2': { cls: 'dir', tag: '桌面收纳', use: '对应磁吸理线器、桌面支架，工位场景可直接套用' },
    'hot-3': { cls: 'ref', tag: '充电宝', use: '可借势价格战话题，突出快充与轻量差异点' },
    'hot-4': { cls: 'ref', tag: '厨房小电', use: '可视空气炸锅可做"租房厨房三件套"选题' },
    'hot-5': { cls: 'ref', tag: '手机配件', use: '"不发黄"可作为手机壳主图卖点之一' },
    'hot-6': { cls: 'dir', tag: '冬季取暖', use: '可做石墨烯原理科普 + 暖手宝软广' },
    'hot-7': { cls: 'none', tag: '平台大盘', use: '行业大盘信息，暂无直接选题价值' },
    'hot-8': { cls: 'dir', tag: '咖啡冲饮', use: '直接对应即溶咖啡种草，场景切入明确' },
  },
  sourceCounts: { 'xhs-trend': 2, 'pai-news': 3, '100ec-24h': 2, 'baidu-hot': 1 },
  tiers: { mustRead: [], browse: [], other: [] },
  sources: [
    { name: '小红书热搜', status: 'ok', count: 2, fetchedAt: '2026-10-17T03:00:00.000Z' },
    { name: '电商派快讯', status: 'ok', count: 3, fetchedAt: '2026-10-17T03:00:00.000Z' },
    { name: '网经社 24h 播报', status: 'ok', count: 2, fetchedAt: '2026-10-17T03:00:00.000Z' },
    { name: '百度实时热点', status: 'ok', count: 1, fetchedAt: '2026-10-17T03:00:00.000Z' },
  ],
};

export const HOT_ATTENTION = {
  config: {
    sources: [
      { id: 'xhs-trend', label: '小红书热搜', kind: 'xhs', enabled: true, note: '站内热点，最贴近种草选题' },
      { id: 'pai-news', label: '电商派快讯', kind: 'news', enabled: true, note: '行业快讯' },
      { id: '100ec-24h', label: '网经社 24h 播报', kind: 'news', enabled: true, note: '电商大盘' },
      { id: 'baidu-hot', label: '百度实时热点', kind: 'hot', enabled: true, note: '泛热点' },
    ],
    domains: [
      { id: 'desk', label: '桌面办公', keywords: ['桌面', '工位', '收纳'], enabled: true },
      { id: 'home', label: '居家生活', keywords: ['租房', '厨房', '家电'], enabled: true },
    ],
  },
};

/** 依依对话记录（展示 RAG 检索问答：答案引用知识库文档并标注来源） */
export const CHAT_MESSAGES = [
  { id: 1, from: '你', text: '视觉规范里关于配色的要求是什么？', at: '2026-10-17T02:00:00.000Z' },
  {
    id: 2, from: '依依', at: '2026-10-17T02:00:05.000Z',
    text: `知识库中与配色相关的规范有两处：\n\n**一、品牌视觉规范（来源：知识库/品牌规范/品牌视觉规范.md）**\n· 主色 1 个（大面积使用：背景/色块），辅助色不超过 2 个（用于卖点强调与信息分层）\n· 首图背景用白底或浅灰（平台主图要求）；场景图可用生活化暖调，但主色占比需 ≥ 60%\n· 文字对比：正文深灰 #333 以上，禁用浅灰小字；强调信息用主色，不要红绿同时抢焦点\n\n**二、品牌规范·视觉（来源：知识库/品牌规范/品牌规范.md）**\n· 主色：品牌紫；辅助色：中性灰、近白；禁止高饱和撞色与大面积渐变`, // ui-rules-ignore: 沙盒对话引用知识库样例原文，颜色值不是界面样式
  },
  { id: 3, from: '你', text: '那磁吸充电宝的参数数据在哪份文档里？', at: '2026-10-17T02:01:00.000Z' },
  {
    id: 4, from: '依依', at: '2026-10-17T02:01:06.000Z',
    text: `在 **原始资料/产品资料/磁吸充电宝.md** 的「产品规格」章节：\n\n· 容量：10000mAh / 37Wh\n· 有线输出：最高 22.5W｜无线输出：磁吸 15W\n· 接口：USB-C 双向｜重量：198g｜尺寸：104 × 68 × 16 mm\n\n提示：资料中未提及输入（自充）功率，如需标注"快充"建议先补齐该项参数。`,
  },
];

/** AI 员工执行记录（工位页/观测页用） */
export const EXECUTIONS = [
  { id: 1, agentId: 'agent-copy', taskId: 13, stage: 'xhs-copy', model: 'deepseek-flash', status: 'success', inputSummary: '[xhs-copy] 办公室即溶咖啡种草笔记', outputSummary: '笔记文案 v1', durationMs: 8420, at: '2026-10-16T02:40:00.000Z' },
  { id: 2, agentId: 'agent-design', taskId: 8, stage: 'main-image', model: 'gpt-image-2.5-sunburst', status: 'success', inputSummary: '[main-image] 轻磁 Pro 磁吸充电宝', outputSummary: '主图 3 张', durationMs: 32700, at: '2026-10-16T09:30:00.000Z' },
  { id: 3, agentId: 'agent-assistant', taskId: null, stage: null, model: 'deepseek-flash', status: 'success', inputSummary: '[audit] 知识库体检', outputSummary: '整理建议清单', durationMs: 6100, at: '2026-10-17T02:30:00.000Z' },
  { id: 4, agentId: 'agent-supervisor', taskId: 32, stage: 'xhs-review', model: 'gpt-6-luna', status: 'running', inputSummary: '[xhs-review] 手机壳种草校对', outputSummary: '', durationMs: 3200, at: '2026-10-17T02:15:00.000Z' },
];

export const DASHBOARD_STATS = {
  totalTasks: 6, awaitingApproval: 3, inProgress: 2, done: 1,
  todayExecutions: 4, totalExecutions: 128, agentsBusy: 2, agentsIdle: 2,
};
