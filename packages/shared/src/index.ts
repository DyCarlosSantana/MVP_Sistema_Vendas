import { v7 } from 'uuid';
import { z } from 'zod';

/** Esquema de identificador. Operações que nascem no aparelho já chegam com id. */
export const idSchema = z.uuid();

/** UUID v7: ordenável por tempo, gerado no cliente para funcionar offline. */
export const newId = (): string => v7();
