/**
 * The scenarios the CSV check page offers for a first check (offline/examples/scenarios/): small synthetic file pairs,
 * each with its configuration and the result to expect with each set of premises. offline/bench/golden.py runs every
 * expectation as a golden case, so the command line and this page are held to the same results.
 *
 * Choosing a scenario fills in its two files and its configuration (key, fields with rules, scope), as loading a
 * configuration file would. It never states a premise: the person states them, as for any check.
 */
import manifestText from "../../../offline/examples/scenarios/scenarios.json?raw";
import contactsSource from "../../../offline/examples/scenarios/contacts-crm/source.csv?raw";
import contactsDestination from "../../../offline/examples/scenarios/contacts-crm/destination.csv?raw";
import ordersSource from "../../../offline/examples/scenarios/orders-rules/source.csv?raw";
import ordersDestination from "../../../offline/examples/scenarios/orders-rules/destination.csv?raw";
import extraSource from "../../../offline/examples/scenarios/extra-in-destination/source.csv?raw";
import extraDestination from "../../../offline/examples/scenarios/extra-in-destination/destination.csv?raw";
import emptyKeySource from "../../../offline/examples/scenarios/empty-key/source.csv?raw";
import emptyKeyDestination from "../../../offline/examples/scenarios/empty-key/destination.csv?raw";
// A workbook is bytes: Vite inlines it as a data URL in the bundle, decoded here, so choosing it makes no request.
import ordersWorkbook from "../../../offline/examples/scenarios/orders-workbook/source.xlsx?inline";
import ordersWorkbookDestination from "../../../offline/examples/scenarios/orders-workbook/destination.csv?raw";
import type { State } from "../offline/evaluator";
import type { ChosenConfig } from "../offline/pageCheck";

export interface Expectation {
  premises: { source_complete: boolean; destination_complete: boolean };
  result: State;
  why: string;
}

export interface Scenario {
  id: string;
  title: string;
  description: string;
  config: { key: [string, string]; fields: { source: string; destination: string; rule: string }[]; scope: "source" | "exact" };
  expect: Expectation[];
  /** The source: CSV text, or for a workbook its bytes, with the worksheet to read. */
  source: string | Uint8Array;
  source_format?: "xlsx";
  source_worksheet?: string;
  destination: string;
}

/** The bytes of a data URL as Vite inlines an asset: base64 after the comma. */
export function dataUrlBytes(url: string): Uint8Array {
  const text = atob(url.slice(url.indexOf(",") + 1));
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

const FILES: Record<string, [string | Uint8Array, string]> = {
  "orders-workbook": [dataUrlBytes(ordersWorkbook), ordersWorkbookDestination],
  "contacts-crm": [contactsSource, contactsDestination],
  "orders-rules": [ordersSource, ordersDestination],
  "extra-in-destination": [extraSource, extraDestination],
  "empty-key": [emptyKeySource, emptyKeyDestination],
};

export const SCENARIOS: readonly Scenario[] = (JSON.parse(manifestText) as { scenarios: Omit<Scenario, "source" | "destination">[] }).scenarios.map((s) => {
  const files = FILES[s.id];
  if (!files) throw new Error(`scenario ${s.id} has no files`);
  return { ...s, source: files[0], destination: files[1] };
});

/** The scenario's configuration as the page holds a choice. */
export const chosenOf = (s: Scenario): ChosenConfig => ({ key: s.config.key, fields: s.config.fields.map((f) => [f.source, f.destination, f.rule] as const), scope: s.config.scope });

/** The premises of an expectation, in words. */
export function premisesText(p: Expectation["premises"]): string {
  if (p.source_complete && p.destination_complete) return "With both statements made";
  if (p.source_complete) return "With only the source statement made";
  if (p.destination_complete) return "With only the destination statement made";
  return "With no statement made";
}
