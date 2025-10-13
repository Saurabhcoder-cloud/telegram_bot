declare module "openai" {
  export interface ChatCompletionMessage {
    content?: string | null;
  }

  export interface ChatCompletionChoice {
    message?: ChatCompletionMessage | null;
    content?: string | null;
  }

  export interface ChatCompletionResponse {
    choices: ChatCompletionChoice[];
  }

  export interface OpenAiInit {
    apiKey: string;
    baseURL?: string;
    defaultHeaders?: Record<string, string>;
  }

  export interface ChatCompletionsCreateParams {
    model: string;
    temperature?: number;
    top_p?: number;
    messages: Array<{ role: string; content: string }>;
  }

  export default class OpenAI {
    constructor(init: OpenAiInit);
    chat: {
      completions: {
        create(params: ChatCompletionsCreateParams): Promise<ChatCompletionResponse>;
      };
    };
  }
}
