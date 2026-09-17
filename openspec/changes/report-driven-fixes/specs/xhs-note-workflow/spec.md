## MODIFIED Requirements

### Requirement: Cover image stage with parallel sub-tasks

「首图设计」阶段显示名 SHALL 统一（修 D-13「封面配图 vs 首图设计」两处叫法），并走阶段别名表（修 D-12 内部 id 暴露）：界面 SHALL NOT 展示 `xhs-image` 等内部阶段 id。改后 SHALL 全局 grep 复查（U7）。

#### Scenario: 阶段名统一且不暴露 id

- **WHEN** 用户查看小红书任务阶段条/交付面板
- **THEN** 阶段显示为统一用户可见名（如「首图设计」），不出现内部 id
