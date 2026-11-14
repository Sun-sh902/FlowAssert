/**
 * The entry of the packaged checker (vite.lib.config.ts): the global FlowAssert has exactly these members. checkCsv
 * and VERSION since 0.4.0; from 1.2.0 also hostProblem, which the iPhone and iPad app asks before any check, so that a
 * WebKit that lacks a feature the check needs is said once, in the checker's own words.
 */
export { checkCsv, hostProblem, VERSION } from "./api";
