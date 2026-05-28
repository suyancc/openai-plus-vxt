# 浏览器自动化框架架构设计

## 1. 目标

本框架面向“多网站、低代码、稳定优先”的浏览器自动化场景。

核心目标：

1. 用最少的业务代码完成稳定的页面自动化。
2. 通过“页面识别 -> 模块分发 -> 模块内状态机”实现通用适配。
3. 所有浏览器操作都由统一运行时管理，避免脚本散落、页面对象跨层滥用、线程混乱。
4. 支持后续持续扩展：新站点、新页面状态、新动作、新辅助工具都可以独立落模块。
5. 以 CloakBrowser 为优先浏览器后端，保留可替换的后端抽象。

## 2. 非目标

1. 不做录制器重建。
2. 不做复杂的可视化流程编排器。
3. 不把每个网站逻辑写成一个大文件。
4. 不允许模块之间直接互相调用页面操作。
5. 不允许检测逻辑和执行逻辑混在一起。

## 3. 核心原则

1. 单会话单线程：一个浏览器会话只由一个 dispatcher 线程拥有。
2. 单页一次处理：同一时刻只处理一个活动页面。
3. 检测与执行分离：detector 只读页面信息，handler 只做动作。
4. 模块注册化：每个模块通过统一接口声明自己的特征、能力和处理入口。
5. 状态外置：页面流转状态、共享数据、临时信号都放在会话状态里。
6. 工具可复用：DOM、URL、文本、重试、截图、日志、等待等能力统一沉淀为工具类。
7. 可替换后端：框架层不直接绑定某个浏览器实现，只依赖后端接口。

## 4. 总体架构

推荐采用“规则注册 + 调度分发 + 模块状态机”的三层模型：

- `core`：运行时、调度器、会话、状态、错误、配置。
- `detection`：页面快照、特征提取、模块匹配、置信度评分。
- `modules`：按网站或业务域拆分的处理模块。
- `tools`：可复用的操作工具类。
- `helpers`：纯函数型辅助类，负责文本、URL、DOM、数据清洗。
- `adapters`：浏览器后端适配层，优先接 CloakBrowser/CDP。

页面处理流程：

1. 主控制循环取出下一个任务或页面。
2. 浏览器会话等待页面稳定。
3. 采集页面快照。
4. 全局 detector 依据模块注册信息计算归属。
5. 分发到命中的模块。
6. 模块内部再判断当前页面状态。
7. 执行动作并回写共享状态。
8. 返回主循环，继续下一轮。

## 5. 推荐目录结构

```text
browser-automation-framework/
  pyproject.toml
  README.md
  configs/
    default.yaml
    modules/
      openai.yaml
      paypal.yaml
  docs/
    architecture.md
    module-contract.md
    detector-rules.md
  src/
    browser_framework/
      __init__.py
      cli.py
      app.py

      core/
        controller.py
        dispatcher.py
        session.py
        event_bus.py
        queue.py
        lifecycle.py
        runtime.py

      browser/
        backend.py
        cloakbrowser_backend.py
        playwright_backend.py
        page_adapter.py
        element_adapter.py
        network_adapter.py
        artifact_adapter.py

      detection/
        snapshot.py
        collector.py
        registry.py
        matcher.py
        scorer.py
        rules.py
        fingerprints.py

      modules/
        base.py
        registry.py
        loader.py
        generic/
          unknown.py
          fallback.py
        examples/
          example_site/
            spec.py
            detector.py
            handler.py
            state.py
            tools.py

      state/
        session_state.py
        module_state.py
        shared_store.py
        signal_store.py
        history.py

      actions/
        action.py
        action_result.py
        action_runner.py
        guards.py
        transitions.py

      tools/
        browser_ops.py
        page_waiter.py
        dom_tools.py
        text_tools.py
        url_tools.py
        retry_tools.py
        artifact_tools.py
        log_tools.py
        file_tools.py

      helpers/
        config_helper.py
        error_helper.py
        string_helper.py
        time_helper.py
        hash_helper.py
        selector_helper.py
        parse_helper.py

      plugins/
        entrypoints.py
        local_loader.py

      logging/
        logger.py
        trace.py
        metrics.py

      errors/
        base.py
        classification.py
        recovery.py

      types/
        common.py
        detection.py
        module.py
        runtime.py

  tests/
    unit/
    integration/
    fixtures/
    scenarios/
```

### 5.1 目录职责

- `core`：框架主控，不放业务站点代码。
- `browser`：只封装浏览器能力，不写模块业务。
- `detection`：只做页面识别与打分。
- `modules`：每个模块只关心一个站点或一个业务域。
- `state`：会话级共享数据与模块内部状态。
- `actions`：动作执行和流程跳转。
- `tools`：模块复用的高频操作。
- `helpers`：纯计算、纯解析、纯清洗。
- `plugins`：外部模块加载机制。
- `logging`：日志、追踪、指标。
- `errors`：错误分类和恢复策略。

## 6. 核心接口

### 6.1 BrowserBackend

浏览器后端统一接口，不让业务代码直接依赖 Playwright/CloakBrowser 的细节。

```python
class BrowserBackend(Protocol):
    def launch(self, config: BrowserConfig) -> "BrowserSession": ...
    def attach(self, endpoint: str) -> "BrowserSession": ...
    def close(self) -> None: ...
```

建议实现：

- `CloakBrowserBackend`：优先实现，基于 CDP / websocket 连接。
- `PlaywrightBackend`：用于本地调试和兜底。

### 6.2 BrowserSession

会话对象由 dispatcher 独占。

```python
class BrowserSession(Protocol):
    def active_page(self) -> "PageAdapter": ...
    def pages(self) -> list["PageAdapter"]: ...
    def new_page(self) -> "PageAdapter": ...
    def close_page(self, page_id: str) -> None: ...
```

### 6.3 PageAdapter

页面适配层，模块只能通过它操作页面。

```python
class PageAdapter(Protocol):
    def url(self) -> str: ...
    def title(self) -> str: ...
    def ready_state(self) -> str: ...
    def goto(self, url: str) -> None: ...
    def click(self, selector: str) -> None: ...
    def fill(self, selector: str, value: str) -> None: ...
    def text(self, selector: str) -> str: ...
    def html(self) -> str: ...
    def screenshot(self, path: str) -> None: ...
    def wait_for(self, condition: str, timeout_ms: int) -> None: ...
```

### 6.4 PageSnapshot

页面快照是 detection 的唯一输入。

建议字段：

- `url`
- `host`
- `path`
- `query`
- `title`
- `ready_state`
- `html`
- `visible_text`
- `forms`
- `inputs`
- `buttons`
- `links`
- `frames`
- `meta`
- `timestamp`

要求：

- snapshot 只读，不含业务动作。
- snapshot 要尽量稳定，不能只靠瞬时 DOM 状态。
- snapshot 中应包含可解释的摘要，而不是只有原始 HTML。

### 6.5 ModuleSpec

模块注册信息，用于识别和排序。

```python
class ModuleSpec(BaseModel):
    module_id: str
    name: str
    version: str = "1.0"
    priority: int = 100
    url_rules: list["UrlRule"]
    dom_rules: list["DomRule"]
    text_rules: list["TextRule"]
    states: list[str]
    capabilities: set[str]
    tags: set[str] = set()
```

### 6.6 DetectionResult

```python
class DetectionResult(BaseModel):
    matched: bool
    module_id: str | None = None
    confidence: float = 0.0
    reason: str = ""
    matched_rules: list[str] = []
    next_state: str | None = None
    retry_after_ms: int = 0
```

### 6.7 ModuleContext

模块执行时的上下文，统一承载页面、状态、工具和日志。

```python
class ModuleContext(BaseModel):
    session_id: str
    module_id: str
    browser: BrowserSession
    page: PageAdapter
    snapshot: PageSnapshot
    state: "SessionState"
    logger: "Logger"
    artifacts: "ArtifactManager"
    tools: "ToolKit"
    config: "RuntimeConfig"
    signals: "SignalStore"
```

### 6.8 PageModule

模块的统一入口。

```python
class PageModule(Protocol):
    def spec(self) -> ModuleSpec: ...
    def on_register(self, registry: "ModuleRegistry") -> None: ...
    def on_enter(self, ctx: ModuleContext) -> None: ...
    def detect(self, snapshot: PageSnapshot) -> DetectionResult: ...
    def handle(self, ctx: ModuleContext) -> "ActionResult": ...
    def on_exit(self, ctx: ModuleContext) -> None: ...
```

建议每个模块内部再拆成：

- `detector.py`：只写规则。
- `handler.py`：只写动作。
- `state.py`：只管本模块状态。
- `tools.py`：只放本模块复用的局部工具。

### 6.9 ActionResult

动作执行结果要能驱动调度器继续运行。

```python
class ActionResult(BaseModel):
    ok: bool
    message: str = ""
    next_action: str | None = None
    next_state: str | None = None
    retryable: bool = False
    retry_after_ms: int = 0
    module_switch: str | None = None
    artifacts: list[str] = []
    data: dict[str, Any] = {}
```

## 7. 页面检测与分发流程

### 7.1 页面稳定器

在识别之前必须先确认页面“足够稳定”。

建议稳定条件：

- `document.readyState == "complete"`
- 主要输入/按钮已渲染
- 网络请求进入静默期
- DOM 变化在连续若干毫秒内没有明显波动

### 7.2 全局分发器

分发器只做以下几件事：

1. 从当前页面生成 snapshot。
2. 调用注册表中的所有 detector。
3. 计算最高优先级命中的模块。
4. 如果命中失败，切到 `UnknownModule`。
5. 把控制权交给目标模块。

### 7.3 命中策略

推荐评分顺序：

1. 明确 URL 规则命中。
2. DOM 结构特征命中。
3. 文本/标题特征命中。
4. 历史状态回填命中。
5. 低置信度兜底命中。

同分处理：

- 优先级高的模块先赢。
- 如果 priority 一样，规则更具体的模块先赢。
- 如果仍然冲突，保留日志并进入人工可诊断状态。

### 7.4 无法识别时的行为

- 不执行破坏性动作。
- 保存截图、HTML、snapshot、候选模块列表。
- 切入 `FallbackModule`。
- 等待下一次页面变化或人工干预。

## 8. 模块内部状态机

每个模块自己维护小状态机，不把所有状态塞进一个中央文件。

例如一个站点模块的典型状态：

- `enter`
- `login`
- `otp`
- `profile`
- `verify`
- `success`
- `error`

模块状态机职责：

1. 解释当前页面属于哪个子状态。
2. 决定下一步动作。
3. 维护本模块局部状态。
4. 上报共享状态给 dispatcher。

模块内部不应该知道别的模块的实现细节。

## 9. 工具类与辅助类

### 9.1 Browser tools

- `BrowserOps`
  - 点击、输入、清空、滚动、聚焦、切页。
- `PageWaiter`
  - 等待页面稳定、元素出现、元素可点击、网络静默。
- `ElementAdapter`
  - 统一封装元素定位、文本读取、属性读取。
- `NetworkAdapter`
  - 读取请求、响应、重定向、下载。
- `ArtifactManager`
  - 保存截图、HTML、日志、快照、trace。

### 9.2 Helper tools

- `UrlHelper`
  - host/path/query 解析、正则匹配、归一化。
- `TextHelper`
  - 去空白、大小写统一、关键词匹配、模糊包含。
- `DomFingerprintHelper`
  - 生成页面结构签名，用于区分同域不同页。
- `SelectorHelper`
  - 多 selector 候选、可见性判断、可点击性判断。
- `RetryHelper`
  - 统一重试策略、回退时间、可恢复错误判断。
- `TimeHelper`
  - 超时计算、窗口统计、稳定区间判断。
- `HashHelper`
  - snapshot 去重、页面签名生成。
- `ParseHelper`
  - 文本提取、值解析、格式归一化。

### 9.3 规则类

- `UrlRule`
- `DomRule`
- `TextRule`
- `CompositeRule`
- `MatchPolicy`

规则类职责：

- 只表达“怎么识别”，不表达“怎么操作”。
- 规则应支持可解释结果，便于调试。

## 10. 共享状态与信号

框架需要两类共享数据：

### 10.1 持久状态

用于跨页面、跨步骤保留的数据，例如：

- 当前会话 id
- 当前模块 id
- 最近一次匹配结果
- 用户输入缓存
- 临时 token
- 已完成步骤标记

建议放在 `SessionState` 和 `SharedStore` 中。

### 10.2 瞬态信号

用于流程之间的轻量通知，例如：

- `page_matched`
- `otp_received`
- `profile_submitted`
- `module_failed`
- `fallback_triggered`

建议放在 `SignalStore` 或内部 `EventBus` 中。

规则：

- 持久状态必须可序列化。
- 瞬态信号必须带时间戳和来源模块。
- 不允许直接共享 raw page 对象到其他模块。

## 11. 错误处理与恢复

错误分类建议：

- `RecoverableError`：可等待、可重试、可刷新。
- `TransientBrowserError`：页面未稳定、元素暂缺、焦点丢失。
- `ModuleMismatchError`：页面识别错误或进入了错误模块。
- `FatalFlowError`：流程不可继续。
- `BackendError`：浏览器后端断连或 CDP 失效。

恢复策略：

1. 轻微错误先重试。
2. 页面状态错误先刷新快照。
3. 模块不匹配先重新识别。
4. 后端断连则重建 session。
5. 连续失败则记录 artifact 并停止当前任务。

统一要求：

- 每个失败都要有上下文。
- 每个失败都要落日志和快照。
- 不要只抛异常不给诊断信息。

## 12. 配置体系

建议使用分层配置：

- `default.yaml`：全局默认值。
- `modules/*.yaml`：各模块规则和参数。
- `runtime env`：环境变量覆盖。

推荐配置项：

- `browser.backend`
- `browser.endpoint`
- `browser.headless`
- `browser.viewport`
- `runtime.single_thread`
- `runtime.page_stable_timeout_ms`
- `runtime.module_match_threshold`
- `runtime.retry_limit`
- `logging.level`
- `logging.artifact_dir`

原则：

- 配置只管参数，不管逻辑。
- 模块级配置与框架级配置分开。
- 规则配置可热更新，但运行时状态不可随意热改。

## 13. 日志与产物

每次任务至少保存：

- 运行日志
- 当前 snapshot
- 页面截图
- 必要的 HTML 片段
- 模块匹配结果
- 错误堆栈

建议的产物目录：

```text
artifacts/
  runs/
    2026-05-24_12-00-00/
      log.txt
      snapshot.json
      page.html
      screenshot.png
      events.jsonl
```

日志内容建议包含：

- 当前 session id
- 当前 page url
- 当前模块 id
- 当前状态
- detector 命中原因
- 动作执行结果

## 14. 测试策略

### 14.1 单元测试

重点测：

- URL 规则
- DOM 规则
- 文本规则
- 页面签名
- 重试策略
- 状态转换
- 配置解析

### 14.2 集成测试

重点测：

- 页面稳定器
- snapshot 采集
- 模块分发
- 跨页面状态保持
- 后端连接与断连恢复

### 14.3 场景测试

重点测真实流程：

- 登录页
- 验证码页
- 资料页
- 支付页
- 未知页兜底

每个场景都要有：

- 输入页
- 预期识别结果
- 预期动作
- 预期产物

## 15. 新模块开发规范

新增一个站点模块时，最小拆分建议如下：

```text
modules/<site>/
  spec.py       # 模块声明、特征、优先级、能力
  detector.py   # URL / DOM / text 规则
  state.py      # 本模块局部状态
  handler.py    # 页面动作
  tools.py      # 本模块专用的小工具
  tests/
```

开发规范：

1. 先写 spec，再写 detector。
2. detector 通过后再写 handler。
3. handler 里只做当前模块动作，不要写别的站点逻辑。
4. 如果一个模块文件开始变大，优先继续拆文件，而不是继续往里堆代码。

## 16. 推荐的执行顺序

如果后面要开始真正开发，建议按这个顺序落地：

1. core：session、dispatcher、state、error。
2. browser：CloakBrowser 后端适配。
3. detection：snapshot、规则、评分。
4. tools：browser ops、waiter、artifact、retry。
5. modules：先做一个示例模块。
6. tests：补齐规则和场景测试。
7. plugins：开放外部模块加载。

## 17. 最终建议

这个框架最适合的形态是：

- 一个统一的运行时
- 一个页面识别分发器
- 多个独立站点模块
- 一组小而稳的工具类
- 一套强约束的状态和错误模型

它的关键不是“写很多智能判断”，而是“让每个职责都小、清楚、可测、可替换”。
