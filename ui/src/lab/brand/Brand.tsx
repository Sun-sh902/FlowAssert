import "@fontsource-variable/inter";
import "@fontsource-variable/newsreader";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource-variable/instrument-sans";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource-variable/inter-tight";
import "@fontsource-variable/martian-mono";
import type { ReactNode } from "react";
import { MarkCalibration, MarkEditorial, MarkTrace, MarkTurnstile } from "./marks";
import "./brand.css";

function MarkRow({ name, note, light, dark }: { name: string; note: string; light: (s: number) => ReactNode; dark: (s: number) => ReactNode }) {
  return (
    <div className="bb-mark">
      <div className="bb-mark-tiles">
        <div className="bb-tile bb-light">
          {light(48)}
          <span className="bb-sizes">
            {light(24)}
            {light(16)}
          </span>
        </div>
        <div className="bb-tile bb-dark">
          {dark(48)}
          <span className="bb-sizes">
            {dark(24)}
            {dark(16)}
          </span>
        </div>
      </div>
      <h3>{name}</h3>
      <p>{note}</p>
    </div>
  );
}

function Swatches({ items }: { items: [string, string, string?][] }) {
  return (
    <div className="bb-swatches">
      {items.map(([name, hex, role]) => (
        <div key={name} className="bb-sw">
          <i style={{ background: hex }} />
          <b>{name}</b>
          <span>{hex}</span>
          {role && <em>{role}</em>}
        </div>
      ))}
    </div>
  );
}

export function Brand() {
  return (
    <main className="bb-root">
      <header className="bb-head">
        <p className="bb-kicker">FlowAssert · design lab</p>
        <h1>Brand, type &amp; colour exploration</h1>
        <p>Every mark is built from vector geometry on a 24-unit grid and is checked at 16, 24 and 48 px on light and dark grounds.</p>
      </header>

      <section>
        <h2 className="bb-h2">Marks</h2>
        <div className="bb-marks">
          <MarkRow
            name="Current · Turnstile ⊢"
            note="Logical “asserts”. Clear at 16px, but abstract: it says logic, not evidence, and needs explaining."
            light={(s) => <MarkTurnstile size={s} />}
            dark={(s) => <MarkTurnstile size={s} bg="#e7ecf3" fg="#0a0d12" accent="#8ab4ff" />}
          />
          <MarkRow
            name="A · Calibration bracket"
            note="Two measuring corners frame a reading. An instrument reticle; strong on dark glass, a little cold on paper."
            light={(s) => <MarkCalibration size={s} fg="#16191e" accent="#2f4fd8" />}
            dark={(s) => <MarkCalibration size={s} />}
          />
          <MarkRow
            name="B · Ruled A"
            note="The A’s crossbar runs out of the letter as a ruled line — the assertion drawn from the word. Editorial, wordmark-led."
            light={(s) => <MarkEditorial size={s} />}
            dark={(s) => <MarkEditorial size={s} fg="#f2efe8" accent="#f08a5d" />}
          />
          <MarkRow
            name="C · Evidence trace"
            note="Open source node → solid destination node, crossed by the assertion tick where comparison happens. Says what the product does."
            light={(s) => <MarkTrace size={s} />}
            dark={(s) => <MarkTrace size={s} fg="#f3efe6" accent="#9aa2ff" />}
          />
        </div>
      </section>

      <section>
        <h2 className="bb-h2">Type systems</h2>
        <div className="bb-type">
          <article className="bb-spec bb-spec-a">
            <p className="bb-tag">A · Precision Instrument</p>
            <p className="bb-a-big">132</p>
            <p className="bb-a-h">4 of 48 records contradict the captured source.</p>
            <p className="bb-a-cap">Martian Mono · readouts, ids, scales — wide, engineered</p>
            <p className="bb-a-body">Inter Tight carries the interface: tight, neutral, dense without strain. Numbers are always mono so channels align.</p>
          </article>
          <article className="bb-spec bb-spec-b">
            <p className="bb-tag">B · Editorial Intelligence</p>
            <p className="bb-b-h">
              One workflow contradicts its source<span>.</span>
            </p>
            <p className="bb-b-body">
              Newsreader Display sets the day’s findings as a lede; Inter sets everything you act on. Large numerals in Newsreader old-style figures,
              tables in Inter tabular.
            </p>
            <p className="bb-b-fig">
              104<small>verified records</small>
            </p>
          </article>
          <article className="bb-spec bb-spec-c">
            <p className="bb-tag">C · Evidence Atelier</p>
            <p className="bb-c-h">
              <em>4 of 48</em> records contradict the captured source cohort.
            </p>
            <p className="bb-c-mono">+1 415 555 10<mark>52</mark> ≠ +1 415 555 10<mark>25</mark></p>
            <p className="bb-c-body">
              Instrument Serif for verdicts only; Instrument Sans for the interface; IBM Plex Mono for every observed value — evidence always looks like
              evidence.
            </p>
          </article>
        </div>
        <p className="bb-note">All faces are SIL Open Font License 1.1, self-hosted via Fontsource (checked with npm view … license).</p>
      </section>

      <section>
        <h2 className="bb-h2">Colour systems</h2>
        <div className="bb-colours">
          <div>
            <h3>A · optical glass</h3>
            <Swatches
              items={[
                ["Void", "#05070a", "canvas"],
                ["Glass", "#0e1219", "panel"],
                ["Ion", "#8ab4ff", "brand · focus"],
                ["Verified", "#45d6a2"],
                ["Mismatch", "#ff6f61"],
                ["Pending", "#f4b545"],
                ["Unverified", "#a49ef0", "dotted, unlit"],
              ]}
            />
            <p>Light is information: only signals glow. Brand ion-blue never marks a state.</p>
          </div>
          <div>
            <h3>B · newsprint</h3>
            <Swatches
              items={[
                ["Newsprint", "#f6f4ef", "canvas"],
                ["Carbon", "#1c1b19", "ink"],
                ["Persimmon", "#c2410c", "brand"],
                ["Verified", "#1f7a4d"],
                ["Mismatch", "#b42318"],
                ["Pending", "#a16207"],
                ["Unverified", "#6b6f80"],
              ]}
            />
            <p>Risk: persimmon brand sits close to Mismatch red — would need re-tuning before adoption.</p>
          </div>
          <div>
            <h3>C · paper &amp; ink</h3>
            <Swatches
              items={[
                ["Paper", "#f3efe6", "canvas"],
                ["Sheet", "#fbf9f4", "surface"],
                ["Carbon", "#1d1b16", "ink"],
                ["Indigo ink", "#2f3590", "brand · assertion"],
                ["Verified", "#2d6a46"],
                ["Mismatch", "#b8391c"],
                ["Pending", "#9c6b0c"],
              ]}
            />
            <div className="bb-hatch">
              <i />
              <span>
                <b>Unverified = hatch, not a hue.</b> Uncertainty is drawn as diagonal hatching over graphite, so “no conclusion” can never be mistaken
                for any colour-coded result.
              </span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
