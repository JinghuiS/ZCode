# Changelog

## [3.15.0](https://github.com/JinghuiS/ZCode/compare/v3.14.2...v3.15.0) (2026-09-25)

### Features

* update v3.14.3 ([29628c9](https://github.com/JinghuiS/ZCode/commit/29628c9acdb81b703bbd4080c207a0e7ce5e276e))
  * The concurrency limit of a running workflow can now be adjusted directly, without stopping the task.
  * Optimized the reuse logic when modifying and restarting workflows.
  * Improved the real-time status display for large workflows.
  * Improved the efficiency of workflow script submission and modification, reducing token consumption.
  * Fixed an issue where workflows could cause the interface to crash in some cases.
  * Fixed an issue where buttons on workflow cards were sometimes pushed out of the interface.
  * Fixed an issue where the workflow tool took up too much context.


### Bug Fixes

* **desktop:** 自动更新退出被窗口吞掉时补硬退出兜底 ([f2bcc65](https://github.com/JinghuiS/ZCode/commit/f2bcc653a0a5ff6193909a938357044f046e6944))

* **services:** 官方 MCP 凭证解析不再传已移除的账号依赖 ([872854d](https://github.com/JinghuiS/ZCode/commit/872854d5db20352fb402558bc862a322d41564fc))


### Documentation

* 修正 DIVERGENCE.md 的测试命令 ([9fba630](https://github.com/JinghuiS/ZCode/commit/9fba630168d5d9226980814d17fa5a40e93e7343))

* 补充与上游 fork 的分叉记录 ([7bf26a2](https://github.com/JinghuiS/ZCode/commit/7bf26a282385e45b9db793ada56dfdd27876d1f7))
