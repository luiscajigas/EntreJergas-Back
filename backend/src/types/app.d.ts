import type { components } from './contract';
import type { createExpressionRepository } from '../repositories/expressions';
import type { createSearchHistoryRepository } from '../repositories/search-history';
import type { createUserRepository } from '../repositories/users';
import type { createSessionStore } from '../auth/sessions';
import type { createRateLimiter } from '../rate-limiter';

export type Schemas = components['schemas'];

/** Definición sin identificador, tal como la produce la IA. */
export type Definition = Schemas['DefinitionText'] & { expression: string };

export interface GameCandidate {
  id: number;
  expression: string;
  countries: string[];
}

export interface AnalyzedExpression {
  text: string;
  type: 'regional' | 'common' | 'typo' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  suggestion: string | null;
  countries: string[];
  register: Schemas['ExpressionEntry']['register'];
  definition: Definition | null;
}

export type AnalyzeText = (text: string) => Promise<AnalyzedExpression[]>;
export type VerifyExpression = (item: AnalyzedExpression) => Promise<boolean>;
export type TranslateDefinition = (definition: Definition) => Promise<Definition>;

export type ExpressionRepository = ReturnType<typeof createExpressionRepository>;
export type SearchHistoryRepository = ReturnType<typeof createSearchHistoryRepository>;
export type UserRepository = ReturnType<typeof createUserRepository>;
export type SessionStore = ReturnType<typeof createSessionStore>;
export type RateLimiter = ReturnType<typeof createRateLimiter>;

declare global {
  namespace Express {
    interface Request {
      /** Lo define el middleware de autenticación en las rutas protegidas. */
      user: Schemas['User'];
    }
  }
}
