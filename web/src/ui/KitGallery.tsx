import { useState } from "react";
import type { ReactNode } from "react";
// The gallery frame's own rules, split out of index.css at the final review
// (M1). AppShell imports this module statically, so a plain `import
// "../kit-gallery.css"` would ship the gallery's stylesheet to every visitor
// even though its JS is tree-shaken away. Behind `import.meta.env.DEV` the
// whole branch is a literal `false` at build time and rollup drops it —
// `grep kit-gallery dist/assets/*.css` is 0.
if (import.meta.env.DEV) void import("../kit-gallery.css");
import { t } from "../i18n/t";
import { reasonLine } from "../plan/cardCopy";
import {
  Bars,
  Button,
  Chip,
  DeltaCard,
  HourBars,
  ListRow,
  LocateIcon,
  ReportIcon,
  RouteCard,
  RouteIcon,
  SearchBar,
  Segment,
  SettingsIcon,
  ShadeStrip,
  Sheet,
  TabBar,
  Tag,
  Toast,
  Toggle,
  WanderIcon,
  deltaLabel,
  fmtTime,
  pct,
} from "./kit";
import type { Tab } from "./kit";

/** Dev-only gallery of the component kit (?kit). Every label goes through
 *  t(), exactly as a real screen would — the kit itself holds no text. */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="kit-sec">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

const HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
const HOUR_PCT = [52, 41, 33, 46, 68, 72, 76, 81, 74, 58];

const STRIP = [
  { shade: true, m: 380 },
  { shade: false, m: 140 },
  { shade: true, m: 580 },
  { shade: false, m: 200 },
  { shade: true, m: 400 },
];

const noop = () => {};
/** The gallery's cards read the same line the app builds: an automatic
 *  "shade first" at 14:00, leaving now (plan/cardCopy.ts, SPEC §1.1). */
const GALLERY_REASON = reasonLine({
  pref: "shade",
  auto: true,
  startMin: 14 * 60,
  sunsetMin: 20 * 60 + 7,
  leaveNow: true,
});

export default function KitGallery() {
  const [sheetOpen, setSheetOpen] = useState(true);
  const [modalOpen, setModalOpen] = useState(true);
  const [tab, setTab] = useState<Tab>("route");
  const [access, setAccess] = useState("stroller");
  const [cobbles, setCobbles] = useState(true);
  const [noise, setNoise] = useState(false);
  const [query, setQuery] = useState("günth");
  const [hour, setHour] = useState(14);

  const leave = hour * 60;
  const arrive = leave + 21;
  const best = 17;

  const routeMeta = `${t("card.km", { km: "1.7" })} · ${t("card.arrive", { time: fmtTime(arrive) })}`;

  return (
    <div className="kit-gallery">
      <h1>{t("app.name")}</h1>

      <Section title={t("actions.start")}>
        <div className="kit-actions kit-actions--wide">
          <Button onClick={noop}>{t("actions.start")}</Button>
          <Button variant="secondary" onClick={noop}>
            {t("actions.steps")}
          </Button>
        </div>
        <div className="kit-actions">
          <Button variant="ink" onClick={noop}>
            {t("actions.done")}
          </Button>
          <Button variant="primary" disabled onClick={noop}>
            {t("actions.send")}
          </Button>
        </div>
        <div className="kit-wrap">
          <Button variant="small" onClick={noop}>
            {t("edge.allowCobbles")}
          </Button>
          <Button variant="smallSecondary" onClick={noop}>
            {t("edge.walkMode")}
          </Button>
          <Button variant="danger" onClick={noop}>
            {t("actions.end")}
          </Button>
        </div>
      </Section>

      <Section title={t("pref.title")}>
        <div className="kit-wrap">
          <Chip variant="dark" sunDot onClick={noop}>
            {t("routes.leaveAt", { time: fmtTime(leave) })}
          </Chip>
          <Chip variant="accent" onClick={noop}>
            {t("pref.chip", { name: t("pref.shade") })}
          </Chip>
          <Chip onClick={noop}>{t("routes.leaveNow")}</Chip>
          <Chip disabled onClick={noop}>
            {t("city.frankfurt")}
          </Chip>
        </div>
        <div className="kit-wrap">
          <Tag variant="acc">{t("card.recommended")}</Tag>
          <Tag variant="quiet">{t("card.quieter")}</Tag>
          <Tag variant="well">{t("card.faster")}</Tag>
        </div>
      </Section>

      <Section title={t("home.whereTo")}>
        <SearchBar value="" placeholder={t("home.whereTo")} onFocus={noop} readOnly />
        <SearchBar
          value={query}
          placeholder={t("home.whereTo")}
          onChange={setQuery}
          onBack={noop}
          onClear={() => setQuery("")}
          backLabel={t("search.back")}
          clearLabel={t("search.clear")}
        />
        <SearchBar
          value={`${t("routes.yourLocation")} → Günthersburgpark`}
          placeholder={t("home.whereTo")}
          onBack={noop}
          onFocus={noop}
          readOnly
          backLabel={t("search.back")}
        />
      </Section>

      <Section title={t("search.back")}>
        <div className="kit-surface">
          <ListRow
            avatar="G"
            title="Günthersburgpark"
            meta={`${t("place.walkMin", { min: 21 })} · ${t("place.shadeNow", { pct: 68 })}`}
            metaTone="accent"
            right={t("card.km", { km: "1.7" })}
            onClick={noop}
          />
          <ListRow
            avatar="G"
            title="Günthersburg Kita"
            meta={t("place.walkMin", { min: 24 })}
            right={t("card.km", { km: "1.9" })}
            onClick={noop}
          />
          <ListRow
            avatar="G"
            title="Güntherstraße"
            meta={t("routes.none")}
            metaTone="warn"
            right={t("card.km", { km: "2.5" })}
            onClick={noop}
          />
        </div>
      </Section>

      <Section title={t("settings.title")}>
        <div className="kit-surface">
          <Segment
            label={t("settings.howYouWalk")}
            value={access}
            options={[
              { value: "walk", label: t("settings.walk") },
              { value: "stroller", label: t("settings.stroller") },
              { value: "wheelchair", label: t("settings.wheelchair") },
            ]}
            onChange={setAccess}
          />
          <ListRow
            title={t("settings.avoidCobbles")}
            right={
              <Toggle on={cobbles} onChange={setCobbles} label={t("settings.avoidCobbles")} />
            }
          />
          <ListRow
            title={t("layers.noise")}
            right={<Toggle on={noise} onChange={setNoise} label={t("layers.noise")} />}
          />
          <ListRow
            title={t("settings.pace")}
            value={t("settings.paceValue", { name: t("settings.paceEasy"), kmh: 4 })}
            onClick={noop}
          />
          <ListRow title={t("settings.city")} value={t("city.frankfurt")} onClick={noop} />
          <ListRow
            title={t("settings.report")}
            right={
              <span className="kit-search-icon">
                <ReportIcon size={20} />
              </span>
            }
            onClick={noop}
          />
        </div>
      </Section>

      <Section title={t("leave.title")}>
        <div className="kit-surface">
          <HourBars
            hours={HOURS}
            pct={HOUR_PCT}
            current={hour}
            best={best}
            onPick={setHour}
          />
          <Bars
            shadePct={HOUR_PCT[HOURS.indexOf(hour)] ?? 0}
            quietPct={74}
            shadeLabel={t("card.shadePct", { pct: HOUR_PCT[HOURS.indexOf(hour)] ?? 0 })}
            quietLabel={t("card.quietPct", { pct: 74 })}
          />
          <ShadeStrip segments={STRIP} />
          <span className="kit-card-meta">
            {t("leave.hint", { time: fmtTime(best * 60), pct: 81, min: 21 })}
          </span>
        </div>
      </Section>

      <Section title={t("card.recommended")}>
        <div className="kit-surface">
          <RouteCard
            minutes={t("card.minutes", { min: 21 })}
            meta={routeMeta}
            tag={{ variant: "acc", label: t("card.recommended") }}
            why={GALLERY_REASON}
            /* the card's name line, from the catalog: `wander.title` used to
               stand in here and CR-01 edit 6 retired it */
            name={t("card.parkLap", { park: t("city.frankfurt") })}
            shadePct={68}
            quietPct={74}
            shadeLabel={t("card.shadePct", { pct: 68 })}
            quietLabel={t("card.quietPct", { pct: 74 })}
            onClick={noop}
          />
          <div className="kit-actions">
            <DeltaCard
              minutes={t("card.minutes", { min: 17 })}
              deltaLabel={deltaLabel(-4)}
              deltaTone="good"
              kindLabel={t("card.faster")}
              note={t("card.sunMin", { min: 9 })}
              onClick={noop}
            />
            <DeltaCard
              minutes={t("card.minutes", { min: 23 })}
              deltaLabel={deltaLabel(2)}
              deltaTone="bad"
              kindLabel={t("card.quieter")}
              kindVariant="quiet"
              note={t("card.cobbles", { m: 120 })}
              onClick={noop}
            />
          </div>
          {/* a warning takes the note's place, in warn colour (SPEC §1.1) */}
          <div className="kit-actions">
            <DeltaCard
              minutes={t("card.minutes", { min: 23 })}
              deltaLabel={deltaLabel(2)}
              deltaTone="bad"
              kindLabel={t("card.shadier")}
              kindVariant="acc"
              note={t("card.shadePct", { pct: 71 })}
              warn={t("card.warnNoShade", { time: fmtTime(17 * 60 + 40) })}
              onClick={noop}
            />
          </div>
        </div>
      </Section>

      <Section title={t("computing.title", { time: fmtTime(leave) })}>
        <div className="kit-surface">
          <div className="kit-skeleton kit-skeleton--shimmer" style={{ height: 96 }} />
          <div className="kit-actions">
            <div className="kit-skeleton" style={{ height: 76, flex: 1 }} />
            <div className="kit-skeleton" style={{ height: 76, flex: 1 }} />
          </div>
        </div>
      </Section>

      <Section title={t("tab.route")}>
        <div className="kit-stage">
          <div className="kit-stage-map">
            <Chip variant="dark" sunDot onClick={noop}>
              {t("routes.leaveAt", { time: fmtTime(leave) })}
            </Chip>
            <Chip variant="accent" onClick={noop}>
              {t("pref.chip", { name: t("pref.shade") })}
            </Chip>
          </div>
          <Sheet open={sheetOpen} tabBar>
            <div className="kit-card-head">
              <span className="kit-card-min">{t("card.minutes", { min: 21 })}</span>
              <span className="kit-card-meta">{routeMeta}</span>
            </div>
            <Bars
              shadePct={68}
              quietPct={74}
              shadeLabel={t("card.shadePct", { pct: 68 })}
              quietLabel={t("card.quietPct", { pct: 74 })}
            />
            <div className="kit-actions kit-actions--wide">
              <Button onClick={() => setSheetOpen(false)}>{t("actions.start")}</Button>
              <Button variant="secondary" onClick={() => setSheetOpen(true)}>
                {t("actions.steps")}
              </Button>
            </div>
          </Sheet>
          <div className="kit-stage-tabbar">
            <TabBar
              active={tab}
              labels={{
                route: t("tab.route"),
                wander: t("tab.wander"),
                settings: t("tab.settings"),
              }}
              onChange={setTab}
            />
          </div>
        </div>
      </Section>

      <Section title={t("pref.title")}>
        <div className="kit-stage kit-stage--short">
          <div className="kit-stage-map">
            <Chip onClick={() => setModalOpen(true)}>{t("pref.title")}</Chip>
          </div>
          <Sheet open={modalOpen} modal label={t("pref.title")} onClose={() => setModalOpen(false)}>
            <div className="kit-card-head">
              <span className="kit-card-name">{t("pref.title")}</span>
              <span className="kit-card-meta">{pct(68)}</span>
            </div>
            <span className="kit-card-meta">{t("pref.note")}</span>
            <Button variant="ink" onClick={() => setModalOpen(false)}>
              {t("actions.done")}
            </Button>
          </Sheet>
        </div>
      </Section>

      <Section title={t("map.borderLabel", { city: t("city.frankfurt") })}>
        <div className="kit-wrap">
          <RouteIcon />
          <WanderIcon />
          <SettingsIcon />
          <ReportIcon />
          <LocateIcon />
        </div>
      </Section>

      {/* the same components under the dark palette, so one screenshot
          shows both themes side by side */}
      <Section title={t("settings.themeDark")}>
        <div data-theme="dark" className="kit-surface">
          <RouteCard
            minutes={t("card.minutes", { min: 21 })}
            meta={routeMeta}
            tag={{ variant: "acc", label: t("card.recommended") }}
            why={GALLERY_REASON}
            shadePct={68}
            quietPct={74}
            shadeLabel={t("card.shadePct", { pct: 68 })}
            quietLabel={t("card.quietPct", { pct: 74 })}
          />
          <div className="kit-wrap">
            <Chip variant="dark" sunDot onClick={noop}>
              {t("routes.leaveAt", { time: fmtTime(leave) })}
            </Chip>
            <Chip variant="accent" onClick={noop}>
              {t("pref.chip", { name: t("pref.shade") })}
            </Chip>
            <Toggle on onChange={noop} label={t("settings.avoidCobbles")} />
            <Toggle on={false} onChange={noop} label={t("layers.noise")} />
          </div>
          <Segment
            label={t("settings.howYouWalk")}
            value={access}
            options={[
              { value: "walk", label: t("settings.walk") },
              { value: "stroller", label: t("settings.stroller") },
              { value: "wheelchair", label: t("settings.wheelchair") },
            ]}
            onChange={setAccess}
          />
          <div className="kit-actions kit-actions--wide">
            <Button onClick={noop}>{t("actions.start")}</Button>
            <Button variant="secondary" onClick={noop}>
              {t("actions.done")}
            </Button>
          </div>
        </div>
      </Section>

      <Toast text={t("share.copied")} />
    </div>
  );
}
