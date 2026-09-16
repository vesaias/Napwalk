import type { ReactNode } from "react";
import { t } from "../../../i18n/t";
import type { PlanResult } from "../../../plan/plan";
import type { Preference } from "../../../plan/preference";
import { barLabels, cardSet, moreLabel } from "../../../plan/cardCopy";
import type { Access } from "../../../router/astar";
import {
  Button,
  Chip,
  ChipRow,
  DeltaCard,
  LocateIcon,
  RouteCard,
  Sheet,
  WanderIcon,
  deltaLabel,
  fmtTime,
  num1,
  useSheetSurface,
} from "../../kit";
import { KIND_KEY, KIND_VARIANT } from "../../kinds";
import { setSnap, useSheetDensity } from "../../sheetSnapStore";
import type { NoRouteReason } from "../../noRoute";
import { backByFor, splitLabel, type LoopName } from "../../wander";
import { NoRoute } from "../route/NoRoute";
import { AccessChip } from "../route/AccessChip";
import { type RoutesDesktop } from "../route/Routes";
import { Computing } from "../edge/Computing";

/** A stand-in for the address, so the catalog sentence can be split around
 *  wherever it put {place}. Plain ASCII and impossible in a street name. */
const SLOT = "<<place>>";

/** The header pill's sentence, split around the address so the address alone
 *  can be muted while the words around it are not (board HB-wander: "Loop
 *  from" 15/600 ink, the street 15/400 muted). One catalog key, not two —
 *  German puts the address in a different place and this splits wherever the
 *  catalog put the placeholder. */
function loopFromParts(): [string, string] {
  const [pre, post = ""] = t("wander.loopFrom", { place: SLOT }).split(SLOT);
  return [pre, post];
}

/** The catalog sentence for a loop's name line, or null while the reverse
 *  geocode that would fill it in is still in flight. */
function nameLine(n: LoopName): string | null {
  if (n === null) return null;
  if (n.k !== "parkLaps") return n.text;
  // "Günthersburgpark, 1 laps" is a bug the reader can see; the catalog
  // carries both forms, and no language this app speaks needs a third
  return t(n.n === 1 ? "card.parkLap" : "card.parkLaps", { park: n.park, n: n.n });
}

/** The line under a loop's badge: the area it walks when that name says
 *  something the recommendation does not (SPEC §1.1, "note = area name when
 *  it differs"), otherwise the cost line `cardSet` already wrote — which
 *  since UX sweep U1 is measured from the card the reader has selected, not
 *  from the recommendation. */
function note(fallback: string, name: LoopName): string {
  const named = nameLine(name);
  if (named !== null && name?.k === "parkLaps") return named;
  return fallback;
}

type WanderProps = {
  plan: PlanResult | null;
  reason: NoRouteReason;
  /** The wait is long enough for a skeleton (the shell debounces it). */
  computing: boolean;
  /** A plan is in flight at all. Between Apply and the skeleton threshold
   *  there is no plan and no skeleton, and "no loop from here" is not the
   *  answer to a question still being asked. */
  planning: boolean;
  /** A modal sheet (duration, preference, leave-at) is up. */
  modalUp: boolean;
  selected: number;
  startMin: number;
  leaveNow: boolean;
  durationMin: number;
  pref: Preference;
  /** What THIS walk is planned with — the chip's override over the settings
   *  (SPEC §1: it changes which loops exist, so it has to be on screen). */
  access: Access;
  /** The place these loops go through (W3), already named: the header says
   *  "Loop via Günthersburgpark" and offers the way back out of it. Null on
   *  W1, "loops from here". */
  viaName: string | null;
  /** The card's reason line (plan/cardCopy.ts reasonLine, SPEC §1.1). */
  reasonLine: string;
  /** "no shade after 17:40" per candidate, in card order (SPEC §1.1: the
   *  warning replaces the reason line on the recommended card and the note
   *  on an alternative). */
  warns: (string | null)[];
  /** Planning after sunset: the shade figures are replaced by a word. */
  night: boolean;
  /** Where the loops start: the reverse-geocoded origin, or the fallback
   *  the header uses until (or unless) that lands. */
  originLabel: string;
  /** The name line for each candidate, indexed the same way they are. */
  names: LoopName[];
  onLocate: () => void;
  onDuration: () => void;
  onPref: () => void;
  onLeave: () => void;
  onAccess: () => void;
  /** The ✕ beside the title: back to loops from here (W3 → W1). */
  onClearVia: () => void;
  /** The other ✕ (W1), and everything that means the same thing: a pull
   *  below the sheet's peek, and Escape. All three leave the loops for the
   *  tab's root (SPEC §3 W1, "✕ always (→ W0, clears loops)"). */
  onClose: () => void;
  onSelect: (i: number) => void;
  onStart: () => void;
  onShare: () => void;
  /** The desktop panel's extras, or null on every other frame — the same
   *  shape the routes screen takes (screens/route/Routes.tsx). There is no
   *  walk to start at a desk, so the primary button hands the loop to the
   *  phone that will walk it (board W-wander). */
  desktop?: RoutesDesktop | null;
  /** The 30 px Layers chip pinned over the right end of the chip row while
   *  these loops are drawn (CR-03 Q2). Built by the tab, hidden by CSS in
   *  the web card, which keeps the 44 px button on the map. */
  layersChip?: ReactNode | null;
  onAllowCobbles: () => void;
  onWalkMode: () => void;
  onShowCity: () => void;
  onSwitchCity: () => void;
  onRetryCity: () => void;
};

/** The Wander tab: loops that start and end where you are, four chips that
 *  change the question, and the same card stack the routes screen uses
 *  (board HB-wander). The tab bar is under the sheet while it peeks, so the
 *  sheet pads its last row clear of it.
 *
 *  Since CR-01 edit 6 the header is ONE 44 px line — `↻ Loop from
 *  Marbachweg 310` — and what a tap on the map does is said once, as a toast
 *  on the first visit (ui/wanderHint.ts), rather than on a second line of
 *  every visit. No bench stops: deferred. */
export function Wander({
  plan,
  reason,
  computing,
  planning,
  modalUp,
  selected,
  startMin,
  leaveNow,
  durationMin,
  pref,
  access,
  viaName,
  reasonLine,
  warns,
  night,
  originLabel,
  names,
  onLocate,
  onDuration,
  onPref,
  onLeave,
  onAccess,
  onClearVia,
  onClose,
  onSelect,
  onStart,
  onShare,
  desktop = null,
  layersChip = null,
  onAllowCobbles,
  onWalkMode,
  onShowCity,
  onSwitchCity,
  onRetryCity,
}: WanderProps) {
  const cands = plan ? [plan.recommended, ...plan.alternatives] : [];
  /** Every card's copy, measured from the loop that is selected rather than
   *  from the recommended one (plan/cardCopy.ts cardSet, UX sweep U1). */
  const set = cardSet(cands, selected, reasonLine, { night, wander: true });
  const i = set === null ? 0 : set.index;
  const big = set === null ? undefined : set.big;
  const rest = set === null ? [] : set.rest;
  const bars = big === undefined ? { shade: "", quiet: "" } : barLabels(big, night);
  /** How much of the compact card this phone can afford — the budget the
   *  layout measures, "full" on every screen the CR is written against
   *  (CR-01 edit 10, ui/sheetBudget.ts). */
  const density = useSheetDensity();
  /** The landscape phone's 300 px rail (CR-03 Q4): the same trade the routes
   *  screen makes — the compact card, so the loops under it survive. */
  const panel = useSheetSurface() === "panel";
  const [pre, post] = loopFromParts();
  /** "2 more · −3 min ▴", or null when there is only the one loop. Counted
   *  and measured against the card on screen rather than the recommended
   *  one — see Routes.tsx (CR-01 review, F5). */
  const more = set === null ? null : moreLabel(set.big, rest.map((e) => e.cand), { night });
  /** the same arithmetic the duration sheet's "or be back by" row does,
   *  from the same departure (final review I1) */
  const meta =
    big === undefined
      ? ""
      : `${t("card.km", { km: num1(big.stats.km) })} · ${t("card.back", {
          time: fmtTime(backByFor(startMin, big.stats.minutes)),
        })}`;

  return (
    <>
      <div className="shell-top">
        <div className="wander-head">
          {/* 20, not 22: the pill is 44 px tall since CR-01 edit 6 */}
          <WanderIcon size={20} />
          <span className="wander-head-title">
            {viaName === null ? (
              <>
                {pre}
                <span className="wander-place">{splitLabel(originLabel).name}</span>
                {post}
              </>
            ) : (
              t("wander.viaTitle", { place: viaName })
            )}
          </span>
          {/* Two different ✕ share this corner, and never at the same time.
              On W3 it is the way out of "loop via" — one step, back to the
              loops from here. On W1 it is the way out of the loops
              themselves, to the tab's root: SPEC §3 W1 reads "✕ always
              (→ W0, clears loops)", and CR-02 slice A made the tab bar's
              absence here permanent, so there is no longer a snap at which
              the bar says where you are instead. */}
          <button
            type="button"
            className="wander-head-clear"
            aria-label={viaName !== null ? t("wander.clearVia") : t("wander.close")}
            onClick={viaName !== null ? onClearVia : onClose}
          >
            ✕
          </button>
        </div>
      </div>

      {/* The four W1 chips, the same 30 px row the routes header carries
          (SPEC §3 W1: "same chip set and behaviour as Routes, plus
          duration"). Four of them do not fit 390 px, so the row scrolls
          sideways — the board draws them running off the edge — and the
          Layers chip sits BESIDE the scroller, 6 px clear of it (CR-03 Q2,
          board CR-04 O2). It was pinned over the row's right end until
          CR-04 r2 and the chips faded under it. */}
      <div className="chip-bar chip-bar--wander">
        <ChipRow className="route-chips--wander">
          {/* Not on W3: with a via, the PLACE sets the length of the walk —
              the there-and-back through it is as long as it is — and a chip
              reading "45 min" over a 103-minute loop would be a lie the
              reader can see (DECISIONS.md 2026-09-07). The ✕ on the title
              brings both the loops from here and their length back. */}
          {viaName !== null ? null : (
            <Chip variant="dark" onClick={onDuration}>
              {t("wander.duration", { min: durationMin })}
            </Chip>
          )}
          <Chip variant="accent" onClick={onPref}>
            {t("pref.chip", { name: t(`pref.${pref}`) })}
          </Chip>
          <Chip onClick={onLeave}>
            {leaveNow
              ? t("routes.leaveNow")
              : t("routes.leaveAt", { time: fmtTime(startMin) })}
          </Chip>
          {/* who is walking, and over what — for THESE loops (SPEC §1). Until
              slice 6 a Wander reader who took the "Walk mode" way out of a
              no-route card got a silently different plan (slice 2 review
              B-6). */}
          <AccessChip access={access} onClick={onAccess} />
        </ChipRow>
        {layersChip}
      </div>

      <div className="shell-float wander-float">
        <button type="button" className="shell-locate" aria-label={t("start.gps")} onClick={onLocate}>
          <LocateIcon size={22} />
        </button>
      </div>

      {computing || (planning && big === undefined) ? (
        <Computing startMin={startMin} open={!modalUp} quiet={!computing} />
      ) : big === undefined ? (
        <Sheet
          open={!modalUp}
          tabBar
          /* the same way out as the results sheet below: there is no loop
             here to keep the reader on */
          onClose={onClose}
          onDismiss={onClose}
          handleLabel={t("sheet.handle")}
        >
          {planning ? null : (
            <NoRoute
              reason={reason}
              /* a plain tap sets the start on this tab (mapTaps.ts) */
              tapToStart
              onLocate={onLocate}
              onAllowCobbles={onAllowCobbles}
              onWalkMode={onWalkMode}
              onShowCity={onShowCity}
              onSwitchCity={onSwitchCity}
              onRetryCity={onRetryCity}
            />
          )}
        </Sheet>
      ) : (
        <Sheet
          open={!modalUp}
          tabBar
          /* Loops open at PEEK too (SPEC §3b W1) — and go the way the ✕
             goes: since CR-02 slice A the tab HAS somewhere to put them
             down, its root, so a pull below peek and Escape mean what the ✕
             means (CR-01 edit 6: "drag-below-peek on W1 does the same as
             ✕"). Before it there was nowhere, and the sheet rested back at
             peek instead. */
          /* …unless the planner found exactly ONE walk (SPEC §3b's
             exception, backlog B12): there is nothing to compare it with,
             no "N more" to drag up for, and a compact card that hides the
             reason line and the labelled bars to save room for a choice
             that does not exist is a worse answer than the full one. The
             peek rung stays rendered — the drag/back ladder is the same on
             every results sheet — only the snap it OPENS at moves. */
          openAt={cands.length === 1 ? "default" : "peek"}
          onClose={onClose}
          onDismiss={onClose}
          handleLabel={t("sheet.handle")}
          /* the same compact card the routes sheet peeks with — with the
             loop's own name on row 2, which is the line that tells one
             loop from another (SPEC §3b W1, board HB-wander) */
          peek={
            <>
              <RouteCard
                variant="compact"
                density={density}
                minutes={t("card.minutes", { min: big.stats.minutes })}
                meta={meta}
                tag={{ variant: KIND_VARIANT[big.kind], label: t(KIND_KEY[big.kind]) }}
                warn={warns[i] ?? null}
                name={nameLine(names[i] ?? null) ?? undefined}
                shadePct={big.stats.shadePct}
                quietPct={big.stats.quietPct}
                shadeLabel={bars.shade}
                quietLabel={bars.quiet}
              />
              <div className="kit-actions kit-actions--peek">
                <Button onClick={onStart}>{t("actions.start")}</Button>
                {more === null ? null : (
                  <Button variant="secondary" onClick={() => setSnap("default")}>
                    {more}
                  </Button>
                )}
              </div>
            </>
          }
        >
          <RouteCard
            variant={panel ? "compact" : "full"}
            minutes={t("card.minutes", { min: big.stats.minutes })}
            meta={meta}
            tag={{ variant: KIND_VARIANT[big.kind], label: t(KIND_KEY[big.kind]) }}
            why={set?.why ?? null}
            warn={warns[i] ?? null}
            name={nameLine(names[i] ?? null) ?? undefined}
            /* the real share after sunset, with only the label changed —
               an empty track would assert 0 % (review F2) */
            shadePct={big.stats.shadePct}
            quietPct={big.stats.quietPct}
            shadeLabel={bars.shade}
            quietLabel={bars.quiet}
          />
          {rest.length === 0 ? null : (
            <div className="kit-actions">
              {rest.map(({ index: k, cand: c, note: cost }) => (
                <DeltaCard
                  key={k}
                  minutes={t("card.minutes", { min: c.stats.minutes })}
                  deltaLabel={deltaLabel(c.deltaMin)}
                  deltaTone={c.deltaMin > 0 ? "bad" : "good"}
                  kindLabel={t(KIND_KEY[c.kind])}
                  kindVariant={KIND_VARIANT[c.kind]}
                  note={note(cost, names[k] ?? null)}
                  warn={warns[k] ?? null}
                  onClick={() => onSelect(k)}
                />
              ))}
            </div>
          )}
          <div className="kit-actions kit-actions--wide">
            {desktop === null ? (
              <Button onClick={onStart}>{t("actions.start")}</Button>
            ) : (
              <Button onClick={desktop.onSend}>{t("actions.sendToPhone")}</Button>
            )}
            <Button variant="secondary" onClick={onShare}>
              {t("actions.share")}
            </Button>
          </div>
        </Sheet>
      )}
    </>
  );
}
