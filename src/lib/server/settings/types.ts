/** A stored AI provider channel. `apiKey` is decrypted plaintext — SERVER-ONLY. */
export interface Channel {
  id: string;
  name: string;
  baseURL: string;
  apiKey: string;
  models: string[];
  fanoutModel?: string;
  synthModel?: string;
  createdAt: string;
}

/** Payload for creating a channel. */
export interface ChannelInput {
  name: string;
  baseURL: string;
  apiKey: string;
  models?: string[];
  fanoutModel?: string;
  synthModel?: string;
}

/** Patch for updating a channel. An omitted/empty `apiKey` keeps the existing key. */
export interface ChannelPatch {
  name?: string;
  baseURL?: string;
  apiKey?: string;
  models?: string[];
  fanoutModel?: string;
  synthModel?: string;
}

/** Client-facing shape — NEVER includes the plaintext key, only a masked hint. */
export interface ChannelPublic {
  id: string;
  name: string;
  baseURL: string;
  models: string[];
  fanoutModel?: string;
  synthModel?: string;
  hasKey: boolean;
  keyHint: string;
  createdAt: string;
}
