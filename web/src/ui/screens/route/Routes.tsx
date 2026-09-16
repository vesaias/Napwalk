import type { ReactNode } from "react";
import { t } from "../../../i18n/t";
import type { PlanResult } from "../../../plan/plan";
import type { Preference } from "../../../plan/preference";
import { barLabels, cardSet, moreLabel } from "../../../plan/cardCopy";
import type { Access } from "../../../router/astar";
import { bestHour } from "../../../plan/hours";
import {
  Button,
  Chip,
  ChipRow,
  DeltaCard,
  HourBars,
  LocateIcon,
  RouteCard,
  Sheet,
  deltaLabel,
  fmtTime,
  num1,
  useSheetSurface,
} from "../../kit";
import { KIND_KEY, KIND_VARIANT } from "../../kinds";
import { setSnap, useSheetDensity, useSheetSnap } from "../../sheetSnapStore";
import { useWholeDayBands } from "../../useShadeBands";
import type { NoRouteReason } from "../../noRoute";
import { ABHeader } from "./ABHeader";
import { AccessChip } from "./AccessChip";
import { NoRoute } from "./NoRoute";
import { Computing } from "../edge/Computing";

export type AutoWindow = { from: number; to: number } | null;

/** What the desktop panel does that the phone does not: hand the walk to a
 *  phone instead of starting it here (Task 15). Null on the phone and on a
 *  tablet, which can still be walked with. */
export type RoutesDesktop = {
  onSend: () => void;
};

type RoutesProps = {
  /** null with `computing` false means there is nothing to show — `reason`
   *  says whether that is a missing start point or a real dead end. */
  plan: PlanResult | null;
  reason: NoRouteReason;
  /** Already debounced by the shell — true only once the wait is worth a
   *  skeleton (mockups/phone-computing.html). */
  computing: boolean;
  /** The planner is busy (the shell's own flag, immediate) — `computing`
   *  is the delayed skeleton. Between the two, the sheet must still not
   *  show a no-route card (Viktor, 2026-09-08: "No route without cobbles"
   *  flashed on every plan). */
  planning: boolean;
  /** A modal sheet (preference, leave-at) is up: this sheet slides out of
   *  the way rather than sitting half-visible behind it, which is what the
   *  mockups show under the scrim. */
  modalUp: boolean;
  selected: number;
  startMin: number;
  leaveNow: boolean;
  pref: Preference;
  /** The card's reason line, "shade first · afternoon sun" — built once by
   *  the shell from plan/cardCopy.ts (SPEC §1.1). */
  reasonLine: string;
  /** "no shade after 17:40" per candidate, in card order (null where the
   *  walk keeps its shade). A warning replaces the reason line on the
   *  recommended card and the note on an alternative (SPEC §1.1). */
  warns: (string | null)[];
  /** Planning after sunset: the shade figures are replaced by a word. */
  night: boolean;
  originLabel: string;
  destName: string;
  /** The walk starts at the live fix: the From field wears the map's dot. */
  fromIsGps: boolean;
  canSwap: boolean;
  /** The access mode this walk is planned with — the header's third chip
   *  (the trip override, or the settings under it). */
  access: Access;
  /** The day's daylight hours, one bar each (plan/hours.ts). */
  hours: number[];
  /** Shade percentage of the recommended route per hour of `hours` — the
   *  numbers the leave-at sheet draws. Empty until a plan has landed. The
   *  desktop panel has the room to show them beside the cards; on the phone
   *  they are what the sheet's TALL snap is for (SPEC §4). */
  hourPct: number[];
  onHour: (hour: number) => void;
  /** The desktop panel's extras, or null on every other frame. */
  desktop?: RoutesDesktop | null;
  /** The 30 px Layers chip pinned to the right edge of the header chip row
   *  while this walk is drawn (CR-03 Q2). The tab builds it — it needs the
   *  reader's layers and the shell's dispatch, which this screen has no
   *  business knowing — and the web card hides it in CSS, where the 44 px
   *  button is on the map and never goes away. */
  layersChip?: ReactNode | null;
  /** The ✕ on the From row: leaves the walk (Home, or the place card). */
  onClose: () => void;
  /** Tapping a field opens the search for THAT end (R4, 2026-09-06). */
  onEditFrom: () => void;
  onEditTo: () => void;
  onSwap: () => void;
  onLocate: () => void;
  onLeave: () => void;
  onPref: () => void;
  onAccess: () => void;
  onSelect: (i: number) => void;
  onStart: () => void;
  /** Hand the walk over — the sheet's secondary button at the default snap
   *  on both tabs (CR-01 edit 4; Steps is out, so Share is what is left). */
  onShare: () => void;
  onAllowCobbles: () => void;
  onWalkMode: () => void;
  onShowCity: () => void;
  onSwitchCity: () => void;
  onRetryCity: () => void;
};

/** The routes screen: the two editable ends and the two chips in one white
 *  header panel, and a sheet with the answer — the highlighted route big,
 *  the others two-up under it, and Start
 *  (mockups/phone-routes-2026-09-06.html).
 *  The mockup's "Steps" button is not rendered: turn-by-turn instructions
 *  are deferred, and a button that cannot work is worse than none. */
export function Routes({
  plan,
  reason,
  computing,
  planning,
  modalUp,
  selected,
  startMin,
  leaveNow,
  pref,
  reasonLine,
  warns,
  night,
  originLabel,
  destName,
  fromIsGps,
  canSwap,
  access,
  hours,
  hourPct,
  onHour,
  desktop = null,
  layersChip = null,
  onClose,
  onEditFrom,
  onEditTo,
  onSwap,
  onLocate,
  onLeave,
  onPref,
  onAccess,
  onSelect,
  onStart,
  onShare,
  onAllowCobbles,
  onWalkMode,
  onShowCity,
  onSwitchCity,
  onRetryCity,
}: RoutesProps) {
  const cands = plan ? [plan.recommended, ...plan.alternatives] : [];
  /** What every card SAYS once one of them is selected: the reason line on
   *  top, the other cards' minutes re-based on it, and each note written as
   *  the cost of taking that walk instead of this one (plan/cardCopy.ts
   *  cardSet, UX sweep U1). Tapping an alternative used to promote it and
   *  leave all three descriptions measured from the walk it replaced. */
  const set = cardSet(cands, selected, reasonLine, { night });
  const i = set === null ? 0 : set.index;
  const big = set === null ? undefined : set.big;
  const rest = set === null ? [] : set.rest;

  // null is "no plan has ever landed for this walk" — the same call the
  // leave-at sheet makes, out of the same function (plan/hours.ts).
  const best = bestHour(hourPct, hours);
  /** The strip prices every daylight hour, so it needs every shade band —
   *  and since the P1 review's F3 nothing fetches those in the background
   *  unless something asks. This is the ask, and it belongs to the frames
   *  that actually draw the strip: the desktop panel always, the phone's
   *  sheet at its TALL snap (`tall={hourStrip}` below). A phone sitting at
   *  peek costs the core and the departure's own bands, which is what rule 7
   *  is about. */
  const snap = useSheetSnap();
  useWholeDayBands(
    (hours[0] ?? 0) * 60,
    (hours[hours.length - 1] ?? 0) * 60 + 59,
    hours.length > 0 && (desktop !== null || snap === "tall"),
  );
  const bars = big === undefined ? { shade: "", quiet: "" } : barLabels(big, night);
  /** How much of the compact card this phone can afford — the budget the
   *  layout measures, "full" on every screen the CR is written against
   *  (CR-01 edit 10, ui/sheetBudget.ts). */
  const density = useSheetDensity();
  /** The landscape phone's 300 px rail (CR-03 Q4, board `c-q4`). It has no
   *  peek rung — there is no sheet at all — so the card the peek rung would
   *  have shown is the card the rail shows: two rows, the labelled meters
   *  on the second, and no reason line. 390 px of height cannot hold the
   *  full card AND the alternatives AND the buttons, and the alternatives
   *  are the half a rail is for. */
  const panel = useSheetSurface() === "panel";
  /** "2 more · −4 min ▴", or null when the planner found only one walk —
   *  then Start takes the whole row (SPEC §3b).
   *
   *  Measured against the card the peek snap is SHOWING, not against the
   *  recommendation: the button's job there is "what a drag would buy", and
   *  once the reader has picked an alternative that is relative to the walk
   *  in front of them. So the selected card is out of the count and the
   *  others' minutes are re-based on it (CR-01 review, F5) — a no-op while
   *  the recommendation is the one selected, which is every first look. */
  const more = set === null ? null : moreLabel(set.big, rest.map((e) => e.cand), { night });
  const meta =
    big === undefined
      ? ""
      : `${t("card.km", { km: num1(big.stats.km) })} · ${t("card.arrive", {
          time: fmtTime(startMin + big.stats.minutes),
        })}`;

  /** "Shade on this route by departure hour" — the desktop panel draws it
   *  beside the cards, and the phone hands it to the sheet's tall snap. */
  const hourStrip =
    best === null ? null : (
      <div className="route-hours">
        <div className="route-hours-cap">{t("leave.hourBars")}</div>
        <HourBars
          hours={hours}
          pct={hourPct}
          current={Math.floor(startMin / 60)}
          best={best.hour}
          onPick={onHour}
        />
      </div>
    );

  return (
    <>
      <div className="shell-top shell-top--header">
        <ABHeader
          fromLabel={originLabel}
          toLabel={destName}
          fromIsGps={fromIsGps}
          canSwap={canSwap}
          onClose={onClose}
          onEditFrom={onEditFrom}
          onEditTo={onEditTo}
          onSwap={onSwap}
        >
          {/* the chip row and, BESIDE it, the Layers chip this screen's
              missing map button became (CR-03 Q2, made a flex sibling by
              CR-04 r2: the scroller takes what is left of the row and ends
              where the chip begins, so nothing is ever behind anything) */}
          <div className="chip-bar">
            <ChipRow className="route-chips--header">
              {/* In the 300 px panel the labels SHORTEN, which is what both
                  landscape boards draw ("14:00 ▾", "Shade ▾") and what their
                  "chips shorten" note means. It is not cosmetic: at full
                  length the three chips measure 348 px into a 284 px row, so
                  the access chip was pushed clean out of a 284 px row (and,
                  while the Layers chip was pinned over that row, came to
                  rest under it and answered taps with the layers sheet — S5
                  review F1). Short keys rather than a substring — CLAUDE.md
                  rule 5, and German shortens differently from English. */}
              <Chip variant="dark" sunDot onClick={onLeave}>
                {leaveNow
                  ? t(panel ? "routes.leaveNowShort" : "routes.leaveNow")
                  : t(panel ? "routes.leaveAtShort" : "routes.leaveAt", {
                      time: fmtTime(startMin),
                    })}
              </Chip>
              {/* One line, unlike Wander's 36 px chip: a 30 px chip has no
                  room for the "auto · 11–16 h" sub-line, and the board does
                  not draw one. The automatic pick is badged where it can be
                  read — inside the sheet this chip opens (SPEC §3 R5). */}
              {/* …and the preference chip has no short form any more: the
                  three names lost the word "first" in round 3 (item 6), so
                  "Shade ▾" IS the long one and `pref.*Short` were four
                  catalog keys saying what `pref.*` already said. */}
              <Chip variant="accent" onClick={onPref}>
                {t("pref.chip", { name: t(`pref.${pref}`) })}
              </Chip>
              {/* who is walking, and over what — for THIS walk (SPEC §1) */}
              <AccessChip access={access} onClick={onAccess} />
            </ChipRow>
            {layersChip}
          </div>
        </ABHeader>
      </div>

      <div className="shell-float route-float">
        <button type="button" className="shell-locate" aria-label={t("start.gps")} onClick={onLocate}>
          <LocateIcon size={22} />
        </button>
      </div>

      {computing || (planning && big === undefined) ? (
        <Computing startMin={startMin} open={!modalUp} quiet={!computing} />
      ) : big === undefined ? (
        <Sheet
          open={!modalUp}
          /* Every sheet must be closable (SPEC §3b). This one was not: with
             no start point the card said "Location is off" and offered one
             button that cannot help a browser which has already refused, and
             neither Escape nor a pull off the bottom of the screen did
             anything, because the sheet was given neither (B13). Both mean
             what the header's ✕ means here — back to the place card the walk
             came from, or Home. */
          onClose={onClose}
          onDismiss={onClose}
          handleLabel={t("sheet.handle")}
        >
          <NoRoute
            reason={reason}
            onLocate={onLocate}
            onAllowCobbles={onAllowCobbles}
            onWalkMode={onWalkMode}
            onShowCity={onShowCity}
            onSwitchCity={onSwitchCity}
            onRetryCity={onRetryCity}
          />
        </Sheet>
      ) : (
        <Sheet
          open={!modalUp}
          /* The answer opens at PEEK on the phone (SPEC §3b): the compact
             card and one button row, so the map keeps the top two thirds
             of the screen. Everything else is one drag — or one tap on the
             handle — away. */
          /* …unless the planner found exactly ONE walk (SPEC §3b's
             exception, backlog B12): there is nothing to compare it with,
             no "N more" to drag up for, and a compact card that hides the
             reason line and the labelled bars to save room for a choice
             that does not exist is a worse answer than the full one. The
             peek rung stays rendered — the drag/back ladder is the same on
             every results sheet — only the snap it OPENS at moves. */
          openAt={cands.length === 1 ? "default" : "peek"}
          /* …and pulled below peek the sheet leaves altogether, which on
             this screen means the walk does: back to the place card it was
             started from, or to the bare map (SPEC §3b, "Route → Home"). */
          onDismiss={onClose}
          handleLabel={t("sheet.handle")}
          /* Dragged up, the sheet has room for the hour profile — which is
             the answer to "should I leave later?" without opening R6. */
          tall={desktop === null ? hourStrip : null}
          /* At the peek snap the sheet keeps what a walker can act on: the
             compact recommended card — minutes, the tag, the arrival, and
             the two meters — and the button that starts the walk (SPEC
             §3b, board HB-routes). Everything else is one drag away. */
          peek={
            <>
              <RouteCard
                variant="compact"
                density={density}
                minutes={t("card.minutes", { min: big.stats.minutes })}
                meta={meta}
                tag={{ variant: KIND_VARIANT[big.kind], label: t(KIND_KEY[big.kind]) }}
                warn={warns[i] ?? null}
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
            /* the meter keeps the walk's real shade share after sunset —
               it is true, and an empty track beside "after sunset" would
               assert 0 % (slice 3 review F2). Only the LABEL changes. */
            shadePct={big.stats.shadePct}
            quietPct={big.stats.quietPct}
            shadeLabel={bars.shade}
            quietLabel={bars.quiet}
          />
          {rest.length === 0 ? null : (
            <div className="kit-actions">
              {rest.map(({ index: k, cand: c, note }) => (
                <DeltaCard
                  key={k}
                  minutes={t("card.minutes", { min: c.stats.minutes })}
                  deltaLabel={deltaLabel(c.deltaMin)}
                  deltaTone={c.deltaMin > 0 ? "bad" : "good"}
                  kindLabel={t(KIND_KEY[c.kind])}
                  kindVariant={KIND_VARIANT[c.kind]}
                  note={note}
                  warn={warns[k] ?? null}
                  onClick={() => onSelect(k)}
                />
              ))}
            </div>
          )}
          {desktop === null || best === null ? null : hourStrip}
          {/* At the default snap the secondary is Share on both tabs: the
              board's Steps button is not rendered, because turn-by-turn is
              out (2026-09-06) and a button that cannot work is worse than
              none (CR-01 repo ruling). */}
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
