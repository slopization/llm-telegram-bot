export const strings = {
  start: (commands: string) =>
    `안녕하세요. LLM 봇입니다.\n\n${commands}\n\n봇의 답변에 답장하면 대화를 이어갈 수 있어요.`,
  helpList: (commands: string) => `${commands}\n\n/help 명령어 로 자세한 설명을 볼 수 있어요.`,
  helpDetail: (name: string, aliases: string[], description: string, usage: string) =>
    `/${name}${aliases.length > 0 ? ` (별칭: ${aliases.map((alias) => `/${alias}`).join(", ")})` : ""}\n${description}\n\n사용법: ${usage}`,
  helpUnknown: (name: string) => `/${name} 명령어는 없어요. /help 로 목록을 볼 수 있어요.`,

  commandDescriptions: {
    start: "봇 소개",
    help: "명령어 설명",
    ask: "LLM에게 질문",
    py: "Python 코드 실행",
    js: "JavaScript 코드 실행",
    bash: "Bash 스크립트 실행",
    usage: "오늘 사용량",
    budget: "provider별 남은 예산",
  },
  commandUsages: {
    start: "/start",
    help: "/help [명령어]",
    ask: "/ask 질문 (다른 메시지에 답장하면서 쓰면 그 메시지를 인용해요)",
    py: "/py 코드 (코드가 담긴 메시지에 답장하면서 /py 만 보내도 돼요)",
    js: "/js 코드 (코드가 담긴 메시지에 답장하면서 /js 만 보내도 돼요)",
    bash: "/bash 스크립트 (스크립트가 담긴 메시지에 답장하면서 /bash 만 보내도 돼요)",
    usage: "/usage",
    budget: "/budget",
  },
  aliasDescription: (name: string, description: string) => `/${name}의 별칭. ${description}`,

  budgetTitle: "남은 예산",
  budgetCredits: (name: string, remaining: string, quota: string, renewsOn: string | undefined) =>
    `${name}: ${remaining} / ${quota} 크레딧 남음${renewsOn !== undefined ? ` (월 지급분 ${renewsOn} 갱신)` : ""}`,
  budgetEstimate: (name: string, remaining: string, budget: string, spent: string, since: string) =>
    `${name}: 약 $${remaining} / $${budget} 남음 (추정, ${since}부터 $${spent} 사용)`,
  budgetUnknown: (name: string) => `${name}: 남은 양을 확인할 수 없어요.`,
  budgetQuota: (name: string, windows: string[], observedAt: string) =>
    `${name}: ${windows.join(", ")} (${observedAt} 기준)`,
  budgetQuotaPending: (name: string) =>
    `${name}: 아직 사용량 정보가 없어요. 이 provider로 한 번 질문하면 보여요.`,
  quotaWindow: (label: string, percent: number, resetsAt: string | undefined) =>
    `${label} 한도 ${percent}% 사용${resetsAt !== undefined ? ` (${resetsAt} 리셋)` : ""}`,
  quotaWeekly: "주간",
  quotaDays: (days: number) => `${days}일`,
  quotaHours: (hours: number) => `${hours}시간`,
  quotaMinutes: (minutes: number) => `${minutes}분`,
  budgetFailed: (name: string) => `${name}: 잔액을 불러오지 못했어요.`,

  askUsage: "명령어와 함께 질문을 입력하거나, 내용이 있는 메시지에 답장하며 사용해 주세요.",
  replyNeedsText: "봇의 답변에는 내용을 입력해서 답장해 주세요.",
  noCode: "실행할 코드가 없어요. 명령어 뒤에 코드를 쓰거나 코드가 담긴 메시지에 답장해 주세요.",
  quotedPrompt: (quote: string, prompt: string) =>
    `다음 메시지를 참고해 주세요.\n\n<quote>\n${quote}\n</quote>\n\n${prompt}`,
  partialQuotePrompt: (quote: string, prompt: string) =>
    `이전 답변에서 다음 부분을 인용했어요.\n\n<quote>\n${quote}\n</quote>\n\n${prompt}`,

  chooseProvider: "provider를 골라 주세요.",
  chooseModel: (provider: string, pageIndex: number, pages: number) =>
    pages > 1
      ? `${provider} 모델을 골라 주세요. (${pageIndex + 1}/${pages})`
      : `${provider} 모델을 골라 주세요.`,
  recentButton: (model: string) => `최근 사용: ${model}`,
  allModelsButton: "전체 보기",
  backButton: "뒤로",
  cancelButton: "취소",
  cancelled: "질문을 취소했어요.",
  previousPageButton: "이전",
  nextPageButton: "다음",
  onlyRequester: "질문한 사람만 고를 수 있어요.",
  selectionExpired: "선택 시간이 지났어요. 다시 질문해 주세요.",
  noModels: "모델 목록을 불러오지 못했어요.",
  generating: (model: string) => `${model} 응답 중...`,

  modelUsed: (provider: string, model: string) => `모델: ${provider}/${model}`,
  tokenUsage: (input: string, cached: string | undefined, output: string) =>
    cached === undefined
      ? `토큰: 입력 ${input}, 출력 ${output}`
      : `토큰: 입력 ${input} (캐시 ${cached}), 출력 ${output}`,

  sources: "출처",
  runHeader: (language: string) => `코드 실행 (${language})`,
  runOutputHeader: "출력",
  runSummary: (language: string, exitCode: number | undefined, seconds: string) =>
    exitCode === undefined
      ? `${language}, ${seconds}초`
      : `${language}, 종료 코드 ${exitCode}, ${seconds}초`,
  runTimedOut: (seconds: number) => `실행 시간 ${seconds}초를 넘겨서 중단했어요.`,
  runOutOfMemory: "메모리 한도를 넘겨서 중단했어요.",
  runNoOutput: "(출력 없음)",
  runTruncated: "\n...(출력이 길어서 잘랐어요)",
  runFilesTruncated: (sent: number, total: number) =>
    `결과 파일 ${total}개 중 ${sent}개만 보냈어요.`,
  runFileTooLarge: (name: string) => `${name} 파일은 50MB를 넘어서 보낼 수 없어요.`,

  sandboxDisabled: "코드 실행 기능이 꺼져 있어요.",
  sandboxQuotaExceeded: (limit: number) => `오늘 코드 실행 한도(${limit}회)를 다 썼어요.`,
  webSearchQuotaNotice: "\n\n(오늘 웹 검색 한도를 다 써서 검색 없이 답했어요.)",
  sandboxQuotaNotice: "\n\n(오늘 코드 실행 한도를 다 써서 코드 실행 없이 답했어요.)",

  usage: (webSearches: number, webLimit: number, runs: number, runLimit: number) =>
    `오늘 사용량\n웹 검색: ${webSearches} / ${webLimit}\n코드 실행: ${runs} / ${runLimit}`,

  errors: {
    credit: "크레딧을 다 써서 답할 수 없어요. 다른 provider의 모델로 다시 질문해 주세요.",
    rateLimit: "요청 한도를 초과했어요. 잠시 후 다시 시도해 주세요. (429)",
    overloaded: "현재 AI 모델의 접속량이 많아요. 잠시 후 다시 시도해 주세요.",
    timeout: "AI 응답 대기 시간이 초과됐어요.",
    api: "API 오류가 발생했어요.",
    empty: "응답에 내용이 없어요.",
    internal: "오류가 발생했어요.",
    noModel: "이 대화에 쓸 모델을 찾지 못했어요. 새로 질문해 주세요.",
    sandbox: "코드 실행 중 오류가 발생했어요.",
  },
} as const;
