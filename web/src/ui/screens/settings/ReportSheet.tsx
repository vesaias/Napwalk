import { useRef, useState } from "react";
import type { CityId } from "../../../cities";
import type { LngLat } from "../../../components/MapView";
import { t } from "../../../i18n/t";
import { buildReport, MAX_TEXT, postReport, type ReportType } from "../../../plan/report";
import { track } from "../../analytics";
import { Button, Chip, Sheet, SheetHead, Toggle } from "../../kit";

type ReportSheetProps = {
  city: CityId;
  /** Where the map is looking right now, or null when no map has settled
   *  yet. Read ONLY when the walker turns the attach toggle on — it is the
   *  map centre, never the GPS fix (SPEC §2: "attach my map position"). */
  mapCenter: () => LngLat | null;
  /** Sent: the shell shows the toast and closes the sheet. */
  onSent: () => void;
  onClose: () => void;
};

/** Question first: the sheet is "Report or ask", and asking is the commonest
 *  reason to open it (SPEC §3 S3), so it is also the type a freshly opened
 *  sheet carries — ALWAYS, from either door. CR-04 ruling 1 struck the
 *  "opens on Wrong shade when reached from a map pin" sentence rather than
 *  build the door it needed: reporting is a Settings flow (the Settings row,
 *  and the city sheet's "Request a city" two taps further in), so the sheet
 *  takes no type argument and there is no branch to preset one. */
const TYPES: { type: ReportType; key: string }[] = [
  { type: "question", key: "report.question" },
  { type: "wrong_shade", key: "report.wrongShade" },
  { type: "blocked", key: "report.blocked" },
  { type: "other", key: "report.other" },
];

/** "Report or ask" — reachable from Settings and from the city sheet's
 *  "Request a city", and from nowhere else (SPEC §2: no long-press entry,
 *  and §3 S3 "the only entry is Settings" since CR-04 r1).
 *
 *  A wrong-shade or blocked-path report is worth little without a place, so
 *  the sheet offers to attach one: the map centre, off by default, named in
 *  full in the context line the moment it is on. That line is the whole
 *  privacy promise — it lists exactly what the POST carries, down to the
 *  coordinate, and nothing more; if there is no centre to attach, Send says
 *  so rather than posting a silent null.
 *
 *  A failure is inline and keeps the text: the one thing worse than a report
 *  that does not send is a report that does not send AND loses what was
 *  typed. Nothing retries on its own — Send is the retry. */
export function ReportSheet({ city, mapCenter, onSent, onClose }: ReportSheetProps) {
  const [text, setText] = useState("");
  const [type, setType] = useState<ReportType | null>("question");
  /** The position the switch captured, and the one the line shows. Held in
   *  state rather than read again at Send so that what the reader is shown
   *  IS what is sent (fix round 1, F4): the two cannot differ. Nothing can
   *  move the map while this modal is up — its scrim takes the pointer, and
   *  on the web everything behind the card is inert — so capturing at the
   *  switch costs nothing and removes a whole class of disagreement between
   *  the promise and the payload. What it captures is the centre the reader
   *  can SEE: the side card's scrim does not dim the map (slice 8 fix round
   *  1, board W-report). */
  const [pos, setPos] = useState<LngLat | null>(null);
  const [attach, setAttach] = useState(false);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  /** The guard the second tap of a double-tap actually hits. `sending` is
   *  state: two trusted click events can both be delivered before React
   *  commits the disabled button, and both then read `false` from the same
   *  stale closure — two POSTs, two rows in R2 (QA F6-02). A ref is written
   *  in the same tick it is read. */
  const inFlight = useRef(false);
  /** The action row, so that focusing the textarea can pull Send and Cancel
   *  back into view. A modal sheet now has a ceiling and scrolls inside it
   *  (index.css, .kit-sheet--modal); with a soft keyboard up, the buttons
   *  are the part that goes under the fold, and no drag brings them back —
   *  peek dismisses a modal sheet (slice 7 review, finding 5). */
  const actions = useRef<HTMLDivElement>(null);

  /** The switch asked for a position and there is none: the map has never
   *  settled (a basemap that failed to load raises neither `load` nor
   *  `moveend`). Sending would post `coord: null` under a line promising a
   *  map position, so it does not send — it says so instead. */
  const missing = attach && pos === null;

  const send = () => {
    if (inFlight.current || missing || text.trim() === "") return;
    inFlight.current = true;
    setSending(true);
    setFailed(false);
    postReport(
      buildReport({
        text: text.trim(),
        type,
        // exactly the coordinate the context line above the button named
        coord: attach ? pos : null,
        city,
        // the attach line promises city, app version, browser and time — and
        // a map position when asked for. A route id is none of those, so no
        // report carries one since the long-press entry went (slice 7).
        route_id: null,
      })
    ).then((r) => {
      inFlight.current = false;
      setSending(false);
      if (r === "sent") {
        // the kind and the city; the text stays in the report (ui/analytics.ts)
        track("report", { city, kind: type ?? "none" });
        onSent();
      } else setFailed(true);
    });
  };

  const title = t("report.title");
  return (
    /* `side`: on the web this is the second card beside the Settings card,
       at the same 444/16 the City list uses — board W-report, and the slice
       8 review's ruling over the centred dialog slice 7 built. The two
       overlays Settings opens now share one container, and the clear scrim
       leaves the map readable, which matters here more than anywhere: this
       sheet asks whether to attach the position the map is showing. On a
       phone the flag does nothing and it is a bottom sheet, as before. */
    <Sheet open modal side label={title} onClose={onClose} handleLabel={t("sheet.handle")}>
      <SheetHead title={title} closeLabel={t("actions.cancel")} onClose={onClose} />
      <textarea
        className="set-textarea"
        value={text}
        maxLength={MAX_TEXT}
        aria-label={title}
        placeholder={t("report.placeholder")}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => actions.current?.scrollIntoView({ block: "nearest" })}
      />
      <div className="set-chips">
        {TYPES.map((o) => (
          <Chip
            key={o.type}
            /* No variant: `pressed` is the whole difference between the
               chosen chip and the other three since CR-03 Q6 — the ink
               fill — and an accent variant under it would only fight it
               for the text colour. */
            pressed={type === o.type}
            onClick={() => setType(type === o.type ? null : o.type)}
          >
            {t(o.key)}
          </Chip>
        ))}
      </div>
      <div className="set-attach-row">
        <span className="set-attach-label">{t("report.attachPos")}</span>
        <Toggle
          on={attach}
          onChange={(on) => {
            setAttach(on);
            setPos(on ? mapCenter() : null);
          }}
          label={t("report.attachPos")}
        />
      </div>
      <span className="set-attach">
        {attach && pos
          ? t("report.attachWithPos", { pos: `${pos[1].toFixed(4)}, ${pos[0].toFixed(4)}` })
          : t("report.attach")}
      </span>
      {missing ? <span className="set-failed">{t("report.noPos")}</span> : null}
      {failed ? <span className="set-failed">{t("report.failed")}</span> : null}
      <div className="kit-actions kit-actions--wide" ref={actions}>
        <Button onClick={send} disabled={sending || missing || text.trim() === ""}>
          {sending ? t("report.sending") : t("actions.send")}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          {t("actions.cancel")}
        </Button>
      </div>
    </Sheet>
  );
}
