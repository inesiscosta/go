/// <reference lib="webworker" />
import { Board, type BoardState } from '../engine/board';
import { chooseMove, type SearchOptions, type SearchResult } from './mcts';

export interface BotRequest {
  id: number;
  state: BoardState;
  options: SearchOptions;
}
export type BotResponse = SearchResult & { id: number };

self.onmessage = (e: MessageEvent<BotRequest>) => {
  const { id, state, options } = e.data;
  const result = chooseMove(Board.fromState(state), options);
  self.postMessage({ id, ...result } satisfies BotResponse);
};
