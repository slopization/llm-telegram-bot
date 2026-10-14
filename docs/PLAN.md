# LLM 텔레그램 봇 기획

조사 기준일: 2026-10-14

## 목표

`/ask`로 질문을 받고, 버튼으로 provider와 모델을 고른 뒤 답변을 스트리밍한다. 체인에 있는 메시지에 답장하면 그 가지의 대화를 이어간다. 모델 목록은 텍스트 생성 모델(`type=llm`)만 보여주고, 응답은 텍스트, 이미지, 파일 등 모델이 돌려주는 것을 모두 텔레그램으로 보낸다. 웹 검색은 제공사 도구를, 코드 실행은 직접 운영하는 Docker 샌드박스를 쓰고, 둘 다 설정 가능한 한도 안에서 쓴다. `/py`, `/js`, `/bash`로 코드를 바로 실행할 수도 있다. 1:1 대화와 그룹 둘 다 지원한다.

## 기술 스택

| 항목 | 선택 | 이유 |
|---|---|---|
| 런타임 | Node.js 24 | 내장 `node:sqlite`를 쓰고, 빌드 없이 `.ts`를 바로 실행한다 |
| 패키지 매니저 | pnpm | |
| 봇 프레임워크 | grammY | Bot API 10.3(최신)까지 지원하는 TS 프레임워크는 grammY뿐이다(v1.46.0, 2026-08-26). Telegraf는 2024-02 이후 npm 릴리스가 없고 Bot API 7.1에서 멈춰 있다. |
| grammY 플러그인 | @grammyjs/auto-retry | 429 재시도 |
| Markdown 파서 | marked | LLM 출력을 텔레그램 entities로 바꾸는 데 쓴다 |
| LLM SDK | @anthropic-ai/sdk, openai, @google/genai | 어댑터마다 해당 벤더의 네이티브 API를 쓴다 |
| 저장소 | SQLite (`node:sqlite`), WAL | 혼자 운영하는 봇이라 별도 DB 서버는 필요 없다. 네이티브 빌드가 필요한 패키지도 없다 |
| 로깅 | pino | 에러 로그에서 API 키를 가린다 |
| 테스트, 린트 | vitest, Biome | |
| 배포 | Docker, compose | |
| 코드 실행 샌드박스 | rootless Docker, 실행마다 새 컨테이너 | Python, Node, Bash가 모두 들어간 이미지 하나를 직접 빌드한다 |
| 업데이트 수신 | Long polling | 공개 포트와 TLS가 필요 없고, 답변 생성이 길어져도 webhook 타임아웃이 없다 |

## Provider

### Claude (Max 월간 API 크레딧)

- Max 5x는 매달 API 크레딧 100달러를 받는다(2026-10-07 릴리스 노트). 다음 달로 넘어가지 않는다.
- claude.ai 설정 > Billing > API credits에서 Console 조직을 연결하고, 그 조직에서 만든 API 키를 쓴다. 카드 등록은 필요 없다.
- 크레딧은 Messages API에도 쓸 수 있으므로 Agent SDK 대신 Messages API를 직접 호출한다. Agent SDK는 세션마다 Claude Code CLI 프로세스를 띄워서 채팅 봇에는 무겁다.
- Console에서 auto-reload를 꺼 둔다. 켜져 있으면 크레딧 소진 후 카드로 결제된다.
- 체인 히스토리가 매 턴 반복되므로 프롬프트 캐싱을 켠다(요청 최상위 `cache_control`).

| 모델 ID | 입력 $/MTok | 캐시 읽기 | 출력 $/MTok | 비고 |
|---|---|---|---|---|
| claude-fable-5-1 | 10 | 0.25 | 50 | thinking 항상 켜짐 |
| claude-opus-5-5 | 4 | 0.20 | 20 | thinking 항상 켜짐 |
| claude-sonnet-5-5 | 2 | 0.10 | 10 | |
| claude-haiku-5-5 | 0.10 | 0.01 | 0.50 | 프롬프트 100K 토큰 이하 기준 |

thinking 토큰은 출력 토큰으로 과금된다. 한 턴에 입력 2,000토큰, 출력 500토큰이고 캐싱과 thinking이 없다고 치면 100달러로 Sonnet 5.5는 약 11,000턴, Opus 5.5는 약 5,500턴을 쓸 수 있다(공식 수치가 아니라 직접 계산한 값).

### Codex 구독 (CLIProxyAPI)

- ChatGPT 구독으로 로그인한 Codex를 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)로 OpenAI 호환 API로 열고, 봇은 `openai-compatible` type으로 연결한다. 봇 코드에는 Codex 전용 어댑터가 없다.
- CLIProxyAPI는 Codex OAuth, 스트리밍, 함수 호출을 지원한다(README). 2026-10-14 기준 별 5만 5천 개, 거의 매일 릴리스가 나온다. 이미지는 `eceasy/cli-proxy-api:v8.0.9`(2026-10-01)로 고정한다.
- `compose.yaml`의 `cli-proxy-api` 서비스로 띄운다. 포트는 `127.0.0.1:8317`에만 연다. 설정은 `cliproxy/config.yaml`(git 제외, 봇이 쓸 클라이언트 키가 들어 있다), 로그인 정보는 `data/cliproxy-auths/`에 둔다.
- 로그인은 디바이스 코드 방식이다. `docker compose exec cli-proxy-api ./CLIProxyAPI --codex-device-login --config /CLIProxyAPI/config.yaml`을 실행하고, 출력된 주소에서 코드를 입력한다.
- 봇 설정: `{"name": "codex", "type": "openai-compatible", "api-url": "http://localhost:8317/v1", "api-key": "<cliproxy/config.yaml의 access.api-keys 값>", "management-key": "<프록시 관리 키 원문>"}`. 봇도 compose로 돌리면 `api-url`은 `http://cli-proxy-api:8317/v1`이다.
- 사용량은 두 경로로 읽는다.
  - 바로 조회: provider 설정에 `management-key`(프록시 관리 키)가 있으면 `/budget`을 부를 때마다 조회한다. 프록시 관리 API `/v8/management/credentials`에서 Codex 계정의 `auth_index`를 찾고, `/v8/management/requests/api-call`로 그 계정의 토큰(`$TOKEN$`)을 넣어 `https://chatgpt.com/backend-api/wham/usage`를 부른다. Codex CLI가 사용량을 조회하는 주소와 같다(openai/codex `rate_limit_resets.rs`). 응답의 `rate_limit.primary_window`, `secondary_window`에 `used_percent`, `limit_window_seconds`, `reset_at`이 있다. 계정 ID 헤더 없이 토큰만으로 200이 왔다(2026-10-14).
  - 응답 헤더: Codex 답변마다 `x-codex-primary-*`, `x-codex-secondary-*` 헤더가 오고, 프록시의 `requests.passthrough-headers: true`로 봇까지 넘어온다. 마지막 값을 기억해 두고, 관리 키가 없거나 바로 조회가 실패하면 이 값을 쓴다.
- 관리 API를 쓰려면 프록시 설정에 `management.secret-key`를 넣는다. 프록시는 시작할 때 이 값을 bcrypt 해시로 바꿔 설정 파일에 다시 쓰므로, 원래 값은 봇의 `management-key`에만 남는다. 봇의 요청은 Docker 포트 매핑을 거쳐 들어와 프록시 입장에서는 localhost가 아니어서 `management.allow-remote: true`로 둔다. 포트는 호스트의 `127.0.0.1`에만 열려 있다.
- 이 type은 웹 검색 도구를 넣지 않는다. 프록시가 Codex 웹 검색을 넘겨 주는지는 확인하지 않았다.
- 가격: 프록시의 모델 목록과 카탈로그(`router-for-me/models`)에는 가격이 없다. Codex 구독은 토큰마다 과금되지 않으므로, 가격은 1페이지 대표 모델을 고르는 정렬에만 쓴다.
  - OpenAI 공식 가격표 Markdown(`https://developers.openai.com/api/docs/pricing.md`)의 "Standard pricing data" 표에서 "Short context output" 열을 읽는다. 모델명 뒤의 괄호 설명(`gpt-5.5 (<272K context length)`)은 떼어 낸다.
  - 모델 목록을 받을 때 하루에 한 번만 다시 받는다. 받기나 파싱에 실패하면 코드에 넣어 둔 가격표(2026-10-14 기준 Codex 모델 8개)를 쓰고 경고 로그를 남긴다.
  - 다른 출처도 확인했다(2026-10-14). models.dev와 LiteLLM 가격 JSON은 공식 가격과 같았다. OpenRouter 모델 API는 자체 가격이라 `gpt-5.6-sol`이 공식(입력 4달러, 출력 20달러)과 달랐다(2달러, 10달러).

### Mindlogic (건국대 BAZE API Gateway)

| 경로 | base URL | 용도 |
|---|---|---|
| Anthropic 네이티브 | `https://factchat-cloud.mindlogic.ai/v1/gateway/claude` | Claude 모델. 프롬프트 캐싱, 이미지/PDF 입력, 웹 검색 |
| Gemini 네이티브 | `https://factchat-cloud.mindlogic.ai/v1/gateway/gemini` | Gemini 모델. `google_search`, `thoughtSignature` 보존 |
| OpenAI Responses | `https://factchat-cloud.mindlogic.ai/v1/gateway` (`/responses/`) | OpenAI 모델. 웹 검색 |
| OpenAI Chat Completions | `https://factchat-cloud.mindlogic.ai/v1/gateway` (`/chat/completions/`) | 나머지 모델(xAI, DeepSeek, Solar 등). 텍스트만 |

- 모델 목록은 `GET /v1/gateway/models/?type=llm`으로 받는다. 조직과 그룹에 따라 목록이 다르다. 실제 응답(2026-10-14)에서 확인한 모델 필드는 아래와 같다. 문서에는 대부분 나와 있지 않다.
  - `owned_by`: `claude`, `openai`, `gemini`, `gemma`, `x-ai`, `upstage`, `deepseek` 등
  - `lifecycle`: `current` 또는 `legacy`
  - `endpoints`: 그 모델을 부를 수 있는 경로 목록(예: `/v1/gateway/chat/completions/`, `/v1/gateway/claude/v1/messages/`)
  - `context_limit`, `max_output_tokens`(없으면 `null`)
  - `pricing`: `{currency: "USD", per_tokens: 1000000, input, output, cache_read, cache_write, web_search_per_1k}`. `web_search_per_1k`가 `null`이면 웹 검색을 지원하지 않는다.
- 게이트웨이는 Responses의 `previous_response_id`를 받지 않는다("Send the full conversation in `input` on every request"). 그래서 매 요청마다 대화 전체를 보낸다.
- Gemini에서 웹 검색과 함수 호출을 같이 쓰려면 `toolConfig.includeServerSideToolInvocations`를 켜야 한다.
- 호출 한도는 회원당 분당 120회다. 크레딧이 없으면 402를 돌려준다.
- User-Agent 헤더가 비어 있으면 Cloudflare가 403으로 막는다.
- 잔액은 `GET /v1/gateway/credits/`, 사용량은 `GET /v1/gateway/usage/`로 조회한다.
- GPT-5 계열과 Gemini 3.1 Pro는 `max_tokens`가 4096보다 작으면 응답이 비어 올 수 있다. 문서는 16000 이상을 권장한다.
- 함수 호출(`tools`)은 Chat Completions, Responses, Anthropic 네이티브 경로 모두 지원한다고 문서에 나와 있다. GPT-5.6 계열과 Grok 4.6은 `reasoning_effort`와 `tools`를 같이 보내면 거부하는데, 게이트웨이가 `reasoning_effort`를 빼고 자동으로 다시 보낸다.

### 어댑터 구조

비텍스트 응답(이미지, 파일, 검색 출처)은 벤더의 네이티브 API에서만 온다. Chat Completions 경로는 텍스트만 돌려준다. 그래서 어댑터를 벤더별로 둔다.

| 어댑터 | 쓰는 곳 |
|---|---|
| Anthropic Messages | Claude 직접 호출, Mindlogic의 Claude 모델(base URL과 키만 다르다) |
| Gemini 네이티브 | Mindlogic의 Gemini 모델 |
| OpenAI Responses | Mindlogic의 OpenAI 모델 |
| OpenAI Chat Completions | Mindlogic의 나머지 모델 |

Mindlogic 모델은 모델 카드의 `endpoints`로 어댑터를 고른다. `/claude/`가 있으면 Anthropic Messages, `/gemini/`가 있으면 Gemini 네이티브, `/responses`가 있으면 OpenAI Responses, 나머지는 Chat Completions다. 모델 ID 접두사로는 고르지 않는다. 예를 들어 `gpt-audio-1.5`는 Chat Completions만 지원한다. 설정 파일의 provider `type`과 어댑터의 관계는 "설정" 절에 있다.

```ts
type Part =
  | { type: "text"; text: string }
  | { type: "image"; mime: string; data: Buffer }
  | { type: "file"; name: string; mime: string; data: Buffer };

interface FunctionTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

type Message =
  | { role: "user" | "assistant"; parts: Part[]; providerParts?: unknown }
  | { role: "tool"; callId: string; parts: Part[] };

interface ChatRequest {
  model: string;
  system?: string;
  messages: Message[];
  webSearch?: { maxUses: number };
  functions: FunctionTool[];
}

type ChatEvent =
  | { type: "text-delta"; text: string }
  | { type: "part"; part: Part }
  | {
      type: "done";
      inputTokens: number;
      outputTokens: number;
      webSearches: number;
      toolCalls: ToolCall[];
      providerParts: unknown;
    };

interface ModelInfo {
  id: string;
  vendor: string;
  outputPricePerMTok: number;
}

interface ChatProvider {
  listModels(): Promise<ModelInfo[]>;
  stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent>;
}
```

- 함수 호출 반복은 어댑터 밖에서 처리한다. `done`에 `toolCalls`가 있으면 봇이 샌드박스에서 실행하고, 결과를 `role: "tool"` 메시지로 붙여 같은 어댑터를 다시 부른다. `toolCalls`가 빌 때까지 반복하되, 요청당 최대 횟수(`sandbox.max-runs-per-request`)를 넘으면 도구 없이 마지막으로 한 번 더 불러 답을 마무리한다.
- `providerParts`는 벤더 API 응답의 원본 content다. 같은 어댑터로 대화를 이어갈 때 그대로 다시 보낸다. Gemini `thoughtSignature`(함수 호출을 연달아 할 때 필요)와 Claude 서버 도구 블록을 잃지 않으려는 목적이다. 함수 호출을 여러 번 주고받은 답변은 그 왕복 전체를 한 노드의 `providerParts`에 저장한다. 다른 어댑터로 넘어가면 `parts`만 보낸다. 원본이 없는 노드는 `parts`로 대신한다.
- 검색 출처는 어댑터가 Markdown 링크 목록으로 바꿔 텍스트 끝에 붙인다. 검색어 목록과 중복을 뺀 출처 링크 목록이다.
- SDK의 자체 재시도(`maxRetries`)로 429, 5xx, 연결 오류를 재시도한다. 스트림이 시작된 뒤의 오류는 재시도하지 않는다.
- 요청마다 타임아웃(기본 10분)을 둔다. 타임아웃, 정지 버튼, 종료 신호는 모두 같은 AbortSignal로 합친다.

### 모델 목록

- 두 provider 모두 API로 모델 목록을 받아 전부 보여준다. 처음 필요할 때 받아서 1시간 동안 재사용한다.
- 채팅 모델만 남긴다. 모델 목록에는 종류를 알려주는 필드가 없어서(CLIProxyAPI는 `id`, `owned_by`, `created`만 준다) 이름으로 거른다.
  - `gpt-`로 시작하는 모델은 `gpt-<숫자>` 형식(`gpt-6-luna`, `gpt-5.5`)만 남긴다. `gpt-image-2`, `gpt-audio-1.5`, `gpt-4o`는 빠진다.
  - 모든 모델에서 이름에 `image`, `dall-e`, `audio`, `tts`, `transcribe`, `whisper`, `realtime`, `embed`, `moderation`, `auto-review`가 단어로 들어 있으면 뺀다.
- Claude는 `GET /v1/models`로 받는다. 이 응답에 가격이 들어 있는지 확인하지 못해서, 출력 토큰 단가표를 코드에 둔다.
- Mindlogic은 `owned_by`로 벤더를 나누고, `pricing.output`을 100만 토큰당 가격으로 바꿔 정렬한다.
- 모델마다 웹 검색 지원 여부와 출력 상한(`max_output_tokens`)을 기록해 두고, 요청할 때 웹 검색 도구를 넣을지와 출력 토큰 상한을 정한다. Claude 직접 호출은 `GET /v1/models`의 `max_tokens`와 `lifecycle`을 쓴다.

### 모델 버튼 1페이지

- 벤더마다 모델 하나만 보여준다. Claude provider는 벤더가 Anthropic 하나라서 버튼도 하나다. legacy 모델은 그 벤더에 current 모델이 있으면 고르지 않는다.
- 어떤 모델을 고를지는 `chat.featured-models`로 정한다. 가격 기준은 출력 토큰 단가다.

| 값 | 고르는 모델 | Claude 예시(Haiku 5.5, Sonnet 5.5, Opus 5.5, Fable 5.1) |
|---|---|---|
| `cheap` | 가장 싼 모델 | Haiku 5.5 |
| `medium`(기본값) | 가운데 모델. 가운데가 두 개면 싼 쪽 | Sonnet 5.5 |
| `expensive` | 가장 비싼 모델 | Fable 5.1 |

- 가격을 모르는 모델은 고를 때 뺀다. 벤더의 모든 모델 가격을 모르면 모델 ID 순으로 정렬해서 같은 규칙을 적용한다.
- 1페이지 맨 아래에 "전체 보기" 버튼을 둔다. 전체 목록은 벤더별로 묶고 가격순으로 정렬해서 페이지를 넘기며 본다.

## 도구

| 도구 | 실행 위치 | 과금 | 쓸 수 있는 어댑터 |
|---|---|---|---|
| 웹 검색 | 제공사 서버 | 검색 1회당, 토큰과 별도 | Anthropic(`web_search`), Gemini(`google_search`), OpenAI Responses(`web_search`) |
| 코드 실행 | 우리 Docker 샌드박스 | 함수 호출 왕복에 드는 토큰만 | 어댑터 4개 모두(함수 호출 `run_code`) |

제공사 코드 실행 도구(Claude `code_execution`, OpenAI `code_interpreter`)는 쓰지 않는다. 이유는 아래와 같다.

- 컨테이너 요금이 없다. 다만 Claude는 원래 싸다. 조직당 매달 1,550시간이 무료이고, 넘으면 컨테이너당 시간당 0.05달러이며, 최소 과금은 5분이다. 웹 검색과 같이 쓰는 요청은 무료다. OpenAI는 1GB 컨테이너 20분에 0.03달러다. 대신 함수 호출을 왕복할 때마다 대화 전체를 입력으로 다시 보내므로 입력 토큰이 늘어난다. 프롬프트 캐싱으로 줄인다.
- 함수 호출을 지원하는 모든 모델에서 코드 실행이 된다. Chat Completions 경로의 모델(xAI, DeepSeek 등)도 포함된다.
- 결과 파일을 우리가 직접 꺼낸다. Mindlogic은 문서에 나열된 경로만 지원하고 제공사의 파일 저장소 같은 네이티브 리소스 API는 지원하지 않는다고 명시한다. OpenAI 컨테이너 파일 다운로드와 Anthropic Files API도 경로 목록에 없다. 그래서 게이트웨이를 거치면 제공사 코드 실행이 만든 파일은 받을 수 없다.
- 실행 환경이 모델과 상관없이 하나로 같다.

### 웹 검색 한도

- 요청당 한도: 웹 검색 횟수 상한을 요청에 넣는다. Claude는 `max_uses`, OpenAI Responses는 `max_tool_calls`로 넣는다. Gemini는 횟수 옵션이 없어서 일일 한도만 적용한다. `max_tool_calls: 1`로 세 도시 검색을 시켰을 때, 두 번째 검색은 `status: "searching"`에서 멈추고 완료된 검색은 1번이었다(2026-10-14).
- 사용자별 일일 한도: 실제로 쓴 횟수를 응답에서 세어 기록한다(Claude는 `usage.server_tool_use`, Gemini는 `groundingMetadata.webSearchQueries` 개수, OpenAI는 `status`가 `completed`인 `web_search_call` 개수). Gemini에 세 도시를 물으면 `webSearchQueries`가 3개 온다. 한도가 남아 있는 동안에만 요청에 도구를 넣는다. 한도를 넘기면 도구 없이 답하고 답변 끝에 "오늘 웹 검색 한도를 다 썼다"는 안내를 붙인다.
- 일일 한도는 매일 0시(`timezone` 설정 기준)에 초기화된다.
- 기본값은 요청당 3회, 사용자별 하루 50회이고 설정 파일에서 바꾼다.

## 샌드박스

### 실행 경로

- `/py 코드`, `/js 코드`, `/bash 스크립트`: LLM 없이 바로 실행한다. 코드 블록(```)으로 감싸도 된다. 코드가 담긴 메시지에 답장하면서 명령어만 보내면 그 메시지의 코드를 실행한다.
- LLM 대화: 모델에게 `run_code(language, code)` 함수 하나를 준다. `language`는 `python`, `javascript`, `bash` 중 하나다. 함수 설명에 네트워크가 없다는 것, 실행 시간 제한, `/output`에 저장한 파일만 사용자에게 전달된다는 것, 설치된 패키지를 적는다.
- 두 경로 모두 사용자별 일일 실행 횟수(`sandbox.daily-limit-per-user`)를 같이 센다. 한도를 다 쓰면 명령어는 안내만 보내고, LLM 대화에는 `run_code`를 넣지 않는다.

### 실행 방식

- 실행마다 새 컨테이너를 만들고, 끝나면 지운다. 실행끼리 상태가 섞이지 않는다. 순서는 아래와 같다.
  1. `docker run -d --pull never ... sleep`으로 컨테이너를 띄운다.
  2. `docker exec -i -w <작업 디렉터리>`로 코드를 stdin에 넘겨 실행한다. Python은 `python -`, Node는 `node --input-type=module -`, Bash는 `bash -s`다. Node는 작업 디렉터리가 `/sandbox`여야 bare import가 `/sandbox/node_modules`에서 찾아진다.
  3. `docker exec ... tar -cf - -C /output .`로 결과 파일을 tar로 받는다.
  4. `docker rm -f`로 지운다. 실행 시간을 넘기면 2단계를 기다리지 않고 바로 지운다.
- `/output`은 tmpfs라서 크기 제한이 걸리고 호스트 디스크에 아무것도 남지 않는다. 봇이 호스트에서 돌든 Docker에서 돌든 경로를 맞출 필요가 없다.
- 컨테이너 옵션
  - `--network none`
  - `--read-only`, 쓰기 가능한 곳은 `/tmp`와 `/output`만 둔다
  - `--memory`, `--memory-swap`(같은 값으로 swap 없음), `--cpus`, `--pids-limit`
  - `--cap-drop ALL`, `--security-opt no-new-privileges`, root가 아닌 사용자로 실행
- rootless Docker에서 자원 제한을 쓰려면 cgroup v2와 cpu, memory, pids 컨트롤러 위임이 필요하다. 개발 머신에서는 셋 다 위임돼 있고, 컨테이너 안의 `memory.max`, `pids.max`, `cpu.max`에 설정값이 그대로 들어가는 것을 확인했다(2026-10-14). cpuset과 io 제한은 쓸 수 없다.
- 개발 머신에서 확인한 사실(2026-10-14, busybox 이미지)
  - `docker cp`는 tmpfs 마운트 안의 파일을 꺼내지 못한다("Could not find the file"). 그래서 `docker exec`로 tar를 받는다.
  - `docker run --rm busybox true`는 약 0.4초, 위 1~4단계 전체는 약 0.7초 걸린다. Python 이미지는 더 느릴 수 있다.
  - 호스트 디렉터리를 연결하는 방식도 동작하지만, `--user 1000`으로 쓴 파일은 호스트에서 subuid(100999)로 보여서 권한 문제가 생길 수 있다. tmpfs 방식을 쓴다.
- 봇을 Docker로 돌릴 때는 rootless Docker 소켓을 봇 컨테이너에 연결한다. 신뢰하는 사람들만 쓰는 봇이고 rootless라서 추가 격리(gVisor 등)는 두지 않는다.

### 이미지가 사라졌을 때

`docker image prune -a`, `docker system prune -a` 같은 명령으로 샌드박스 이미지가 지워져도 봇이 스스로 복구한다.

- `docker run`에 `--pull never`를 붙여서, 이미지가 없으면 Docker Hub에서 받으려 하지 않고 바로 "No such image" 에러가 나게 한다.
- 그 에러가 나면 저장소의 `sandbox/`에서 이미지를 다시 빌드하고 한 번 더 실행한다. 여러 요청이 동시에 와도 빌드는 한 번만 하고, 나머지 요청은 빌드가 끝나기를 기다린다.
- 봇이 시작할 때도 이미지가 있는지 확인하고, 없으면 백그라운드에서 빌드한다.
- 개발 머신에서 이미지를 지운 뒤 요청 두 개를 동시에 보내서 빌드가 한 번만 일어나고 두 요청 모두 실행되는 것을 확인했다(2026-10-14). 빌드 캐시가 남아 있으면 약 7초 걸린다. 빌드 캐시까지 지워졌으면 몇 분 걸리고 네트워크가 필요하다.

### 이미지

`llm-bot-sandbox` 이미지 하나에 Python, Node, Bash가 모두 들어 있다. 네트워크가 없으므로 실행 중에 패키지를 설치할 수 없어서, 자주 쓰는 패키지는 빌드할 때 미리 넣는다. 패키지 목록과 lock 파일은 저장소의 `sandbox/`에 두고, 빌드할 때 lock 파일 그대로 설치해서 매번 같은 버전이 들어가게 한다.

| 구성 | 내용 |
|---|---|
| 기반 | `python:3.14.8-slim-trixie`. Python 3.15는 pyyaml의 바이너리 휠이 아직 없어서 3.14를 쓴다 |
| Python 패키지 | uv 0.13.1로 `pyproject.toml`과 `uv.lock`을 `uv sync --frozen`으로 `/opt/venv`에 설치한다. uv는 빌드 때만 쓰고 이미지에는 넣지 않는다 |
| Node | `node:24.21.0-slim` 단계에서 pnpm 12.11.2로 `package.json`과 `pnpm-lock.yaml`을 설치한 뒤, `node` 실행 파일과 `/sandbox/node_modules`만 복사한다 |
| Bash | Debian 기본 bash와 coreutils |
| 실행 사용자 | uid/gid 1000 `sandbox` |

미리 넣은 패키지

| 용도 | Python | Node |
|---|---|---|
| 수치, 통계 | numpy, scipy, sympy, statsmodels | mathjs, decimal.js |
| 표 데이터 | pandas, openpyxl, tabulate | papaparse, exceljs |
| 그래프 | matplotlib, seaborn | |
| 머신러닝 | scikit-learn | |
| 그래프 이론 | networkx | |
| 이미지 | pillow | |
| HTML, XML, YAML 파싱 | beautifulsoup4, lxml, pyyaml | cheerio, yaml |
| 날짜, 유틸 | python-dateutil | date-fns, lodash |

- matplotlib 기본 글꼴에는 한글이 없어서 그래프의 한글이 네모로 나온다. 한글 글꼴(Debian `fonts-nanum`)을 넣고 matplotlib 기본 글꼴을 NanumGothic, DejaVu Sans 순으로 지정한다. seaborn의 `set_theme()`는 글꼴 목록을 다시 덮어써서, `run_code` 설명에 `sns.set_theme(font="NanumGothic")`을 쓰라고 적는다.
- matplotlib는 쓰기 가능한 설정 디렉터리가 없으면 실행마다 글꼴 캐시를 다시 만든다. 그래서 빌드할 때 캐시를 `/opt/matplotlib`에 만들어 두고, Python이 시작할 때 `sitecustomize.py`가 `/tmp/matplotlib`에 심볼릭 링크를 만든다.
- Node 코드는 ES 모듈로 실행한다(top-level await 사용 가능).
- 네트워크가 없으므로 requests, axios 같은 HTTP 클라이언트는 넣지 않는다.
- 개발 머신에서 확인한 값(2026-10-14): 컨테이너 생성부터 삭제까지 약 0.3초, numpy, pandas, matplotlib import 합계 약 0.8초다. 메모리 초과는 종료 코드 137로, 프로세스 수 초과는 fork 실패로, 네트워크는 ENETUNREACH로 막힌다.

### 결과 전송

- stdout과 stderr를 코드 블록으로 보내고, 종료 코드와 실행 시간을 같이 표시한다. 텍스트는 `sandbox.output-chars`에서 자른다.
- 시간 초과와 메모리 초과는 에러가 아니라 실행 결과로 보여준다.
- `/output`에 저장된 파일은 최대 `sandbox.max-files`개까지 보낸다. 이미지는 사진과 원본 파일로, 나머지는 문서로 보낸다.
- LLM이 코드를 실행했을 때는 실행한 코드와 출력을 답변 안에 접힌 블록(`<details>`)으로 넣는다. 결과 파일은 답변 확정 뒤에 따로 보낸다.
- `/py`, `/js`, `/bash` 실행 결과에 명령어 없이 답장하면 아무것도 하지 않는다. 결과를 두고 LLM에 물어보려면 결과에 답장하면서 `/ask`를 쓴다. 이때 실행한 코드와 결과가 인용 컨텍스트로 들어간다.

### 기본 한도

| 설정 | 기본값 |
|---|---|
| 사용 여부 | 켬 |
| 사용자별 일일 실행 횟수 | 50 |
| LLM 요청당 최대 실행 횟수 | 5 |
| 실행 시간 | 10초 |
| 메모리 | 512MB |
| CPU | 1 |
| 프로세스 수 | 128 |
| `/tmp`, `/output` 크기 | 각 64MB |
| 출력 텍스트 길이 | 3500자 |
| 결과 파일 수 | 10 |
| 동시 실행 | 2(넘으면 대기) |

## 사용 흐름

### 새 대화

1. `/ask 프롬프트`를 보낸다. 사진이나 문서 캡션에 `/ask ...`를 붙여도 받는다.
2. 봇이 provider 버튼(설정 파일의 provider 이름)과 "최근 사용: 모델명" 단축 버튼을 보여준다.
3. provider를 고르면 같은 메시지가 모델 버튼 1페이지로 바뀐다.
4. 모델을 고르면 버튼 메시지를 지우고 답변을 스트리밍한다.

### 이어가기

- 체인 안의 메시지에 답장하면 명령어 없이 바로 실행한다. 모델은 가장 가까운 조상 노드의 모델을 이어받는다.
- 같은 메시지에 여러 번 답장하면 가지가 나뉜다.
- 사용자가 일부만 인용해서 답장하면(`quote`) 인용한 부분을 프롬프트에 같이 넣는다.
- 에러 메시지나 `/start`, `/help` 출력에 답장하면 아무것도 하지 않는다.
- 체인 밖의 명령어 없는 메시지에는 1:1 대화에서도 반응하지 않는다.

### 다른 메시지를 프롬프트로 쓰기

- DB에 없는 메시지(다른 사람의 메시지 등)에 답장하면서 `/ask 프롬프트`를 보내면 새 대화로 보고, 답장 대상 메시지 본문을 인용 컨텍스트로 넣는다.
- 내용 없이 `/ask`만 보내면 답장 대상 메시지를 그대로 프롬프트로 쓴다.
- 봇 답변에 내용 없이 `/ask`만 보내면 "내용을 입력해서 답장해 달라"고 안내한다. 답장 없이 내용도 없는 `/ask`에는 사용법을 안내한다.

### 답변 아래 버튼

- 다른 모델로 다시: 같은 부모 노드에서 다른 모델로 새 가지를 만든다.

### 명령어

| 명령 | 별칭 | 내용 |
|---|---|---|
| /start | | 인사말과 명령어 목록. AI를 호출하지 않는다 |
| /help [명령어] | | 명령어 목록, 또는 명령어별 설명과 별칭 |
| /ask | /a | 새 대화 |
| /py | | Python 코드를 샌드박스에서 실행 |
| /js | | JavaScript 코드를 샌드박스에서 실행 |
| /bash | | Bash 스크립트를 샌드박스에서 실행 |
| /usage | | 오늘 웹 검색과 코드 실행 사용량, 일일 한도 |
| /budget | | provider별 남은 예산("예산" 절 참고) |

- `/ask@봇이름` 형식도 받는다. 대소문자는 가리지 않는다. 다른 봇을 지정한 명령(`/ask@다른봇`)은 무시한다.
- 명령어 메뉴(`setMyCommands`)는 1:1 대화, 그룹, 그룹 관리자 세 범위에 각각 등록하고, 별칭도 메뉴에 올린다.

### 버튼 처리 규칙

- callback_data는 64바이트까지만 담을 수 있다. 프롬프트와 선택 상태는 DB의 `pending` 테이블에 두고 버튼에는 짧은 ID만 넣는다.
- 그룹에서는 `/ask`를 보낸 사람만 버튼을 누를 수 있다.
- provider 선택, 모델 1페이지, 전체 목록 화면에는 모두 "취소" 버튼이 있다. 누르면 선택 대기를 지우고 메시지를 "질문을 취소했어요."로 바꾼다.
- 모든 callback에 `answerCallbackQuery`로 응답한다. 허용되지 않은 사용자의 callback에는 아무 반응도 하지 않는다.

## 그룹

- privacy mode는 켜 둔 채로 쓴다. 이 상태에서 봇이 받는 메시지는 `/ask@봇이름` 명령, 봇이 그룹에 마지막으로 글을 쓴 봇일 때의 일반 명령(`/ask`), 봇 메시지에 대한 답장이다.
- 그룹에서 대화를 이어가려면 봇의 답변에 답장한다. 체인 안의 사용자 메시지(예: 처음 보낸 `/ask`)에 답장한 경우에도 봇이 받는지는 문서에 나와 있지 않다. 0단계에서 확인한다.
- 그룹 멤버 누구나 봇 답변에 답장해서 가지를 이어갈 수 있다. 버튼은 `/ask`를 보낸 사람만 누를 수 있다.
- forum topic이 있는 그룹에서는 보낼 때 `message_thread_id`를 넘긴다. topic 메시지의 `reply_to_message`가 topic 생성 서비스 메시지를 가리키는 경우가 있다는 커뮤니티 보고가 있어서, 체인을 따라 올라갈 때 서비스 메시지에서 멈춘다.
- 텔레그램 공식 FAQ 기준으로 봇은 한 그룹에 분당 20개를 넘게 보낼 수 없다. 4096자로 나눈 긴 답변도 이 한도에 들어간다.

## 체인 저장 구조

Bot API는 `reply_to_message`를 한 단계만 주고, 지난 메시지를 조회하는 메서드가 없다. 그래서 봇이 주고받은 메시지를 모두 저장하고 부모 포인터를 따라 올라가며 대화를 재구성한다.

```
nodes
  id, parent_id, chat_id, user_id, role, text,
  provider, model, provider_parts(json),
  input_tokens, output_tokens,
  web_searches, sandbox_runs, created_at

attachments
  id, node_id, kind(image|file), mime, file_name,
  telegram_file_id, telegram_file_unique_id, local_path

tg_messages
  chat_id, message_id, node_id
  (PK: chat_id, message_id)

pending
  id, chat_id, user_id, node_id, provider, created_at

user_prefs
  user_id, last_provider, last_model
```

- `tg_messages`는 한 답변이 텍스트, 사진, 파일 등 여러 텔레그램 메시지로 나뉘어도 하나의 노드로 묶는다. 그중 어느 메시지에 답장해도 같은 대화로 이어진다.
- 컨텍스트를 만들 때는 부모를 따라 최대 N개 노드(기본 50, 설정 가능)까지 올라간다.
- 사용자가 보낸 사진과 문서는 받을 때 바로 내려받아 로컬에 저장한다. getFile 다운로드 링크는 1시간 정도만 유효하고, 내려받을 수 있는 파일은 20MB까지다.
- 같은 파일(`file_unique_id`)은 히스토리 전체에서 한 번만 첨부한다. 한 요청의 첨부 파일 합계에는 상한(기본 100MB)을 둔다.
- 허용되지 않은 사용자의 메시지는 저장하지 않는다. 단, 허용된 사용자가 그 메시지에 답장하면 그 메시지 하나만 저장한다.
- 스키마 변경은 `PRAGMA user_version` 기반 마이그레이션 배열로만 한다.

## 출력

### 형식

- rich message(`sendRichMessage`)는 쓰지 않는다. Telegram Web과 Telegram X는 rich message를 "지원하지 않는 메시지"로만 보여주는데, API는 성공을 돌려줘서 봇이 알 수 없다(커뮤니티 보고, 2026-07).
- 일반 메시지에 `entities`를 붙여 보낸다. `parse_mode`(HTML, MarkdownV2)를 쓰지 않으므로 이스케이프 실수나 파싱 실패가 없다.
- 변환은 marked의 lexer로 Markdown을 토큰으로 나눈 뒤 텍스트와 entities로 바꾸는 순수 함수로 직접 만든다. @gramio/format의 `markdownToFormattable`은 "앞으로 바뀔 수 있다"는 주석이 달려 있어서 쓰지 않는다.

| Markdown | 텔레그램 |
|---|---|
| 굵게, 기울임, 취소선, 인라인 코드, 링크 | `bold`, `italic`, `strikethrough`, `code`, `text_link` |
| 코드 블록 | `pre`(언어 포함) |
| 인용 | `blockquote` |
| 제목 | 굵은 줄 |
| 목록 | `- `, `1. `와 들여쓰기 |
| 표 | 열을 맞춘 `pre` |
| 구분선 | `---` 줄 |

- LLM이 실행한 코드와 출력은 접히는 인용(`expandable_blockquote`)으로 넣는다.
- 답변 끝에 사용한 모델과 토큰을 기울임으로 붙인다. 예: `모델: codex/gpt-6-luna`(provider 이름/모델) 다음 줄에 `토큰: 입력 1,234 (캐시 1,000), 출력 567`. 입력은 캐시 읽기와 쓰기를 포함한 전체 값이고, 캐시 읽기가 없으면 괄호를 뺀다. 코드 실행으로 여러 번 호출했으면 합계다. provider가 사용량을 주지 않아 모두 0이면 토큰 줄은 빼고 모델 줄만 붙인다. 체인에 저장하는 답변 텍스트에는 넣지 않는다.

### 길이

- 메시지 하나는 4096자까지다. entities offset은 UTF-16 단위다.
- 줄 단위로 4096자 이하로 나누고, 경계에 걸친 entity는 양쪽으로 나눈다. 한 줄이 4096자를 넘으면 강제로 자른다.
- 나눈 메시지는 모두 같은 노드로 기록한다. 첫 메시지는 사용자 메시지에 답장하고, 버튼은 마지막 메시지에 단다.

### 1:1 대화 스트리밍

- `sendMessageDraft`를 직접 부른다. 설정한 간격(기본 1초)마다 지금까지 받은 Markdown 전체를 다시 변환해서 같은 `draft_id`로 보낸다. 굵게 표시처럼 뒤에 닫히는 서식이 있어서 매번 전체를 다시 변환한다.
- 텍스트가 4096자를 넘으면 앞부분을 `sendMessage`로 확정하고 새 `draft_id`로 이어간다.
- 답변이 끝나면 남은 부분을 `sendMessage`로 확정한다.
- 답변이 끝날 때까지 4.5초마다 "입력 중" 표시(`sendChatAction typing`)를 보낸다. 첫 글자가 나오기 전 모델이 생각하는 동안에도 반응이 보인다. 그룹 답변과 `/py`, `/js`, `/bash` 실행 중에도 같다.
- @grammyjs/stream은 쓰지 않는다. 이 플러그인은 조각마다 entity를 붙여 이어 보내는 방식이라, 앞부분 서식이 나중에 바뀌는 Markdown을 다시 그릴 수 없다.
- 드래프트 갱신 빈도: 텔레그램은 드래프트와 메시지 수정의 호출 한도를 공개하지 않는다. 커뮤니티 보고에서는 0.8초 간격으로 수정하다가 수백 초짜리 대기(`retry_after` 226~1390초)를 받은 사례가 있다. 그래서 간격을 두고, auto-retry에는 `maxDelaySeconds`를 걸어 긴 대기를 받으면 드래프트를 포기하고 완성본만 보낸다.
- 정지: 드래프트에 `can_stop`을 켜면 텔레그램 기본 정지 버튼이 나온다. `stopped_message_generation` 업데이트를 받으면 AbortController로 LLM 요청을 끊고, 그때까지 받은 내용을 확정한다.

### 그룹

- 드래프트는 1:1 전용이다. "모델명 응답 중" 메시지를 먼저 보내고 typing 표시를 유지하다가, 답변이 끝나면 그 메시지를 한 번만 수정해서 완성된 답변의 첫 부분으로 바꾼다. 나머지 부분은 답장으로 이어 보낸다. 이 메시지의 message_id가 답변 노드가 된다.
- 그룹 정지: `can_stop`은 드래프트에만 있으므로, 2단계에서 "응답 중" 메시지에 정지 버튼을 단다.

### 이미지와 파일

- 텍스트 답변을 확정한 뒤, 그 메시지에 답장하는 형태로 따로 보낸다.
  - 이미지: `sendPhoto`로 보내고, 압축되지 않은 원본을 `sendDocument`로 한 번 더 보낸다. 여러 장이면 media group으로 묶는다. 10MB를 넘으면 문서로만 보낸다.
  - 파일: `sendDocument`로 보낸다. 50MB를 넘으면 보낼 수 없다는 안내를 보낸다.
  - 보낸 메시지는 모두 `tg_messages`에 같은 노드로 기록하고, 받은 `file_id`를 `attachments`에 저장한다.
- entities를 붙인 전송이 실패하면 같은 텍스트를 entities 없이 다시 보낸다.

### 정지 업데이트

- 정지 업데이트(`stopped_message_generation`)는 `allowed_updates`를 비워 두면 기본으로 받는다. 1:1 대화 topic에서는 이 업데이트의 `chat`에 사용자가 아닌 봇의 채팅이 들어오는 버그가 보고돼 있어서(tdlib/telegram-bot-api #891) `draft_id`로 진행 중인 요청을 찾는다.

## 에러 처리

- 사용자에게는 에러 종류별로 정해진 한국어 문구만 보여준다. SDK 원문 에러는 로그에만 남긴다.

| 경우 | 재시도 버튼 |
|---|---|
| 크레딧 소진 | 있음(다른 모델로 다시) |
| 요청 한도 초과(429), 서버 과부하(503, 529) | 있음 |
| 그 밖의 API 오류(500대, 연결 실패) | 있음 |
| 타임아웃 | 있음 |
| 안전 정책 차단, 빈 응답 | 있음 |
| 봇 내부 오류 | 있음 |
| 첨부 파일 용량 초과, 프롬프트 없음 | 없음 |

- 크레딧 소진 판정
  - Claude: 400 `invalid_request_error`이면서 메시지가 "Your credit balance is too low"로 시작하는 경우. 메시지는 공식 문서(api-credits-for-subscribers)에 있고, 상태 코드가 400이라는 것은 Anthropic 직원이 GitHub 이슈에서 확인했다(anthropic-sdk-python #1646, 2026-08-06). 기계적으로 구분할 코드가 없어서 메시지 문자열로 판정한다.
  - Claude 지출 한도: 429이면서 `error_code`가 `enforced_spend_limit_reached`인 경우(tier 월 한도, Start tier는 월 500달러), 400이면서 메시지가 "You have reached your specified API usage limits"로 시작하는 경우(직접 설정한 한도). 402 `billing_error`도 같이 처리한다.
  - Mindlogic: 402
- 크레딧이 소진돼도 다른 provider로 자동 전환하지 않는다. 사용자가 모델을 직접 고르는 구조라서, 안내 메시지와 "다른 모델로 다시" 버튼을 띄운다.
- 재시도 버튼은 원래 사용자 메시지를 DB에서 다시 읽어 같은 모델로 실행한다. 이미 재시도 중이면 "이미 재처리 중"이라는 토스트를 띄운다.
- 종료 신호(SIGTERM)를 받으면 진행 중인 요청을 끊고, 끊긴 요청에는 에러 답장을 보내지 않는다. 정리가 10초 안에 끝나지 않아도 프로세스를 끝낸다.
- 명령어 메뉴 등록은 봇 시작을 막지 않도록 백그라운드에서 한다. 짧은 시간에 여러 번 재시작하면 텔레그램이 등록에 대기를 걸 수 있다.
- 반응, 메시지 삭제, 메시지 수정, `answerCallbackQuery` 같은 부가 호출은 실패해도 로그만 남기고 넘어간다.

## 동시성

grammY의 `bot.start()`는 업데이트를 하나씩 처리한다. 핸들러가 LLM 답변이나 코드 실행을 기다리면 그동안 다른 업데이트가 막힌다. 그래서 핸들러는 노드 저장과 선택 버튼 전송만 하고, LLM 답변과 코드 실행은 기다리지 않는 백그라운드 작업으로 돌린다. 백그라운드 작업은 목록으로 관리하고, 종료 신호를 받으면 진행 중인 요청을 끊은 뒤 작업이 끝나기를 기다린다. 이 구조라 @grammyjs/runner는 쓰지 않는다.

## 예산

`/budget`은 provider마다 남은 양을 보여준다. provider마다 알아내는 방법이 다르다.

| provider | 방법 | 정확도 |
|---|---|---|
| `mindlogic` | `GET /v1/gateway/credits/`의 `total.remaining`, `total.quota`, `monthly_allocated.renewal_date` | 게이트웨이가 돌려주는 실제 값 |
| `claude` | 월 예산(`monthly-budget-usd`)에서, 갱신일(`budget-reset-day`)부터 이 봇이 쓴 비용 합계를 뺀다 | 추정 |
| `openai-compatible` | `management-key`가 있으면 프록시 관리 API로 Codex 사용량을 바로 조회한다. 없으면 응답 헤더에서 읽은 마지막 값을 쓴다. "5시간 한도 n% 사용, 주간 한도 n% 사용"과 리셋 시각을 보여준다. 둘 다 없으면 "아직 사용량 정보가 없다"고 표시 | 바로 조회는 조회 시점의 실제 값. 헤더 값은 마지막 응답 시점의 값이라 봇을 재시작하면 다음 질문 전까지 비어 있다 |

- Claude는 잔액 조회 API가 없어서 추정한다. 답변마다 입력, 캐시 쓰기, 캐시 읽기, 출력 토큰과 웹 검색 횟수를 공식 단가(2026-10-14 가격표)로 계산해 노드에 `cost_usd`로 저장한다. 웹 검색은 1,000회에 10달러, Haiku 5.5는 프롬프트가 10만 토큰을 넘으면 높은 단가를 쓴다. 캐시 쓰기는 5분 캐시 단가로 계산한다.
- 추정에서 빠지는 것: 같은 API 키를 봇 밖에서 쓴 사용량, 실패한 요청에서 이미 쓴 토큰, 가격표에 없는 모델. `/budget` 응답에는 이 설명을 붙이지 않고, 추정치 줄에 "추정"이라고만 표시한다.

## 접근 제어와 비용

- 1:1 대화는 `allowed-user-ids`에 있는 사용자만, 그룹은 `allowed-chat-ids`에 있는 그룹에서만 쓸 수 있다. 허용한 그룹 안에서는 멤버 누구나 쓸 수 있다. 목록이 비어 있으면 아무도 쓸 수 없다. 봇 이름을 아는 사람 누구나 크레딧을 쓰는 일을 막기 위해서다.
- 허용되지 않은 메시지와 callback에는 아무 반응도 하지 않는다.
- 노드마다 토큰 수와 도구 사용 횟수를 기록하고 `/usage`에서 사용자별로 합산한다.
- Claude 크레딧 잔액을 조회하는 API는 없다. Console 화면(Settings > Billing)에서만 보인다. Usage and Cost API는 지난 사용량만 주고 Admin 키가 필요하다. 그래서 봇이 응답의 `usage`로 직접 집계한다.
- 크레딧만 연결한 Claude 조직은 최소 Start tier다. Opus, Sonnet, Haiku 5.5 모두 모델별로 분당 1,000회, 입력 200만 토큰, 출력 40만 토큰까지다.

## 설정

`config.json` 하나에 모든 설정을 둔다. API 키가 들어가므로 git에서 제외한다.

```json
{
  "timezone": "Asia/Seoul",
  "telegram": {
    "bot-token": "",
    "allowed-user-ids": [],
    "allowed-chat-ids": [],
    "draft-interval-ms": 1000
  },
  "chat": {
    "max-context-nodes": 50,
    "timeout-seconds": 600,
    "featured-models": "medium"
  },
  "providers": [
    {
      "name": "claude-platform",
      "type": "claude",
      "api-url": "",
      "api-key": "",
      "monthly-budget-usd": 100,
      "budget-reset-day": 1
    },
    {
      "name": "mindlogic",
      "type": "mindlogic",
      "api-url": "",
      "api-key": ""
    }
  ],
  "tools": {
    "web-search": {
      "enabled": true,
      "max-uses-per-request": 3,
      "daily-limit-per-user": 50
    }
  },
  "sandbox": {
    "enabled": true,
    "daily-limit-per-user": 50,
    "max-runs-per-request": 5,
    "timeout-seconds": 10,
    "memory-mb": 512,
    "cpus": 1,
    "pids": 128,
    "disk-mb": 64,
    "output-chars": 3500,
    "max-files": 10,
    "concurrency": 2
  }
}
```

- `api-url`이 빈 문자열이면 type별 기본 URL을 쓴다.
- `monthly-budget-usd`와 `budget-reset-day`는 잔액 API가 없는 provider의 월 예산과 갱신일이다. `/budget`에서 남은 예산을 추정하는 데 쓴다. Max 크레딧은 결제일에 지급되므로 `budget-reset-day`에 결제일을 넣는다.
- `draft-interval-ms`는 1:1 대화에서 드래프트를 갱신하는 최소 간격이다. `max-context-nodes`는 체인을 따라 올라갈 최대 노드 수, `timeout-seconds`는 답변 하나에 걸 수 있는 최대 시간이다. `featured-models`는 모델 버튼 1페이지에 보일 모델의 가격대(`cheap`, `medium`, `expensive`)다.
- `telegram`과 `providers`를 뺀 항목은 생략하면 기본값을 쓴다.
- `name`은 provider 버튼에 보이는 이름이고, 체인 노드의 `provider` 값으로도 저장된다.
- 같은 type을 여러 번 등록할 수 있다(예: 키가 다른 Claude 조직 두 개).

| type | 어댑터 | 기본 URL |
|---|---|---|
| `claude` | Anthropic Messages | `https://api.anthropic.com` |
| `openai-compatible` | OpenAI Chat Completions | 없음(필수) |
| `mindlogic` | 모델 ID 접두사로 Anthropic Messages(`claude-`), Gemini 네이티브(`gemini-`), OpenAI Responses(`gpt-`), Chat Completions(나머지) 중에서 고른다 | `https://factchat-cloud.mindlogic.ai/v1/gateway` |

Mindlogic을 `openai-compatible`로 등록해도 동작하지만, Chat Completions 경로는 텍스트만 돌려주고 Claude 프롬프트 캐싱도 되지 않는다. 그래서 Mindlogic 전용 type을 둔다. `openai-compatible`은 나중에 OpenRouter 같은 provider를 붙일 때 쓴다.

## 코드 규칙

- 사용자에게 보이는 한국어 문구는 `src/strings.ts` 한 곳에 둔다.
- 렌더링, 명령어 파싱, 모델 버튼 구성처럼 결정만 하는 로직은 I/O 없는 순수 함수로 두고 단위 테스트한다.
- 로그는 pino로만 남긴다. 에러는 `err` 키로 넘기고, 직렬화할 때 API 키를 가린다.

## 디렉터리 구조

```
src/
  main.ts            진입점, 의존성 연결, 종료 처리
  config.ts          config.json 읽기와 검증
  strings.ts         사용자에게 보이는 한국어 문구
  log.ts
  time.ts
  commands/parse.ts  명령어 파싱
  bot/               핸들러, 버튼, 답변과 코드 실행 흐름
  db/                SQLite 스키마, 마이그레이션, 저장소
  providers/         어댑터 4개, provider 생성, 모델 선택
  pipeline/          컨텍스트 구성, 함수 호출 반복, 에러 분류
  render/            Markdown과 실행 결과를 텔레그램 entities로 변환, 4096자 분할
  sandbox/           Docker 실행기, run_code 정의, tar 읽기
  telegram/          전송, 드래프트와 그룹 출력, 미디어 전송
sandbox/             샌드박스 이미지(Dockerfile, pyproject.toml, uv.lock, package.json, pnpm-lock.yaml)
scripts/verify/      0단계 검증 스크립트
tests/
Dockerfile           봇 이미지
compose.yaml
```

## 배포

- 봇 이미지는 `node:24.21.0-slim`에 Docker CLI와 buildx(`docker:29.8.1-cli`에서 복사)를 넣는다. 봇 컨테이너 안에서 샌드박스 컨테이너를 띄우고, 이미지가 없으면 다시 빌드한다.
- `compose.yaml`은 `config.json`(읽기 전용), `data/`(DB), rootless Docker 소켓(`${XDG_RUNTIME_DIR}/docker.sock`)을 연결한다.
- rootless Docker에서는 컨테이너 안의 root가 소켓 주인인 호스트 사용자로 매핑된다. 그래서 봇 컨테이너는 root로 실행한다.
- 개발 머신에서 봇 이미지를 빌드하고, 봇 컨테이너 안에서 샌드박스 실행과 샌드박스 이미지 빌드가 되는 것을 확인했다(2026-10-14).
- Node는 주소가 여러 개면 주소마다 250ms만 연결을 기다리고 다음 주소로 넘어간다. 개발 머신에서는 `api.telegram.org`의 IPv4 연결에 약 250ms가 걸리고 IPv6는 닿지 않아서, 기본값으로는 8번 중 8번 실패했다. 봇 시작 시 `net.setDefaultAutoSelectFamilyAttemptTimeout(2000)`으로 늘리면 8번 모두 성공했다(2026-10-14). 이 설정은 `fetch`(LLM SDK)와 `node:https`(grammY의 node-fetch) 양쪽에 적용된다.

## 단계

### 0단계: 사전 검증

문서에 없는 부분을 먼저 확인한다. 실행할 스크립트는 `scripts/verify/`에 있다.

| 확인할 것 | 스크립트 | 결과(2026-10-14) |
|---|---|---|
| Mindlogic 모델 카드 필드, `/credits/` 응답 | `mindlogic-models.ts` | 확인함("Mindlogic" 절) |
| Mindlogic Chat Completions 스트림이 `data: [DONE]`으로 끝나는지 | `mindlogic-stream.ts` | 끝난다. 마지막 데이터 청크에 `usage`가 온다 |
| Gemini 검색 횟수를 세는 방법 | `gemini.ts` | `webSearchQueries` 개수 |
| `max_tool_calls`로 검색 횟수를 막을 수 있는지 | `openai-responses.ts` | 막힌다 |
| 실제 파이프라인(어댑터, 함수 호출 반복, 샌드박스, 이어지는 질문)이 경로마다 동작하는지 | `pipeline.ts` | Mindlogic 네 경로 모두 동작한다(claude-haiku-5-5, gemini-3.5-flash-lite, gpt-5.6-luna, solar-mini4, deepseek-v4.1-flash) |
| Claude 직접 호출의 모델 목록과 rate limit 헤더 | `claude-models.ts` | Claude API 키가 없어서 아직 못 했다 |
| 배포 서버의 rootless Docker에 cpu, memory, pids 컨트롤러가 위임돼 있는지 | `docker info` | 개발 머신은 위임돼 있다 |
| privacy mode 그룹에서 봇이 아닌 체인 메시지에 답장했을 때 봇이 받는지, 드래프트 정지 버튼 업데이트 | `telegram-probe.ts` | 텔레그램 봇 토큰이 없어서 아직 못 했다 |

검증 스크립트는 경로마다 가장 싼 모델을 기본값으로 쓴다.

패키지 소스와 타입 정의로 확인을 마친 항목:

- grammY 타입의 `sendMessageDraft`에는 `can_stop`, `keep_on_stop`이 있고, `Update`에는 `stopped_message_generation`이 있다.
- @google/genai는 `httpOptions.baseUrl`로 base URL을 바꿀 수 있다.
- Claude 웹 검색은 `max_uses`로 요청당 횟수를 막는다. Gemini `googleSearch`에는 횟수 옵션이 없다. OpenAI SDK의 Responses 생성 파라미터 타입에는 `max_tool_calls`가 없어서 타입을 넓혀서 보낸다.

### 1단계: MVP

- `/ask`, provider 버튼, 모델 버튼(1페이지와 전체 목록)
- 어댑터 4개, 텍스트 스트리밍(1:1 대화), 그룹은 완성본 한 번에 전송
- 이미지와 파일 응답 전송
- 웹 검색과 한도
- 샌드박스: `/py`, `/js`, `/bash`, LLM `run_code` 함수 호출과 반복 처리, 샌드박스 이미지 하나, 이미지가 사라졌을 때 다시 빌드
- 답장 체인, SQLite 저장
- 그룹 지원(버튼 권한, forum topic)
- 허용 목록, 에러 문구
- `/usage`, `/budget`

### 2단계

- 사진 입력
- 정지 버튼
- 재시도 버튼, 다른 모델로 다시, 최근 모델 단축 버튼
- 크레딧 소진 처리

### 3단계

- PDF와 문서 입력
- 앨범(500ms 동안 모아서 한 요청으로 보낸다)
- 1:1 대화 topics(Bot API 9.3 이후)
- 사용자별 비용 한도

### 보류

- 이미지 생성(Mindlogic `type=image` 모델, `/images/generate/`)
- 링크와 문서 요약 명령(`/summarize`)

## 문서에 없는 것

2026-10-14에 공식 문서, SDK 소스, GitHub 이슈를 조사한 뒤에도 남은 항목이다.

### 키나 토큰이 생기면 확인할 것

- privacy mode 그룹에서 다른 사람의 `/ask@봇이름` 메시지에 답장했을 때 봇이 받는지. 공식 문구는 "봇을 위한 메시지에 대한 답장"이고, 명령 메시지가 여기에 들어가는지는 문서에 없다.
- Claude 직접 호출의 모델 목록과 rate limit 헤더
- Gemini 웹 검색 과금이 `webSearchQueries` 개수와 같은지. 문서에는 "검색 1회당"이라고만 나온다. 응답 개수와는 맞지만 청구 내역과 비교하지는 않았다.

### 확인할 방법이 없는 것

- Claude 크레딧 약관의 "계정 소유자만 사용" 조항이 친구들이 쓰는 봇에도 적용되는지. Commercial Terms는 고객이 자기 최종 사용자에게 서비스를 제공하는 것을 허용하지만, 크레딧 약관과의 관계를 설명하는 문구는 없다. 2026-11-12부터 시행되는 Usage Policy는 허가 없는 재판매와 우회 접근 제공을 금지하고, 소비자용 챗봇에는 AI라는 사실을 알리라고 요구한다.
- Mindlogic에서 스트림을 중간에 끊었을 때의 과금. 시작 전에 거절된 요청은 과금되지 않는다는 것만 문서에 있다.
- Mindlogic 요청 타임아웃, 스트림 최대 시간, 동시 요청 수 제한
- 텔레그램 editMessageText와 드래프트의 호출 한도. 공식 수치는 일반 한도(채팅당 초당 1개, 그룹 분당 20개)뿐이다.
