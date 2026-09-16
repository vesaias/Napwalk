import type { ComponentType } from "react";
import { RouteIcon, WanderIcon, SettingsIcon } from "./icons";

export type Tab = "route" | "wander" | "settings";

type TabBarProps = {
  active: Tab;
  labels: Record<Tab, string>;
  onChange: (tab: Tab) => void;
};

const TABS: { id: Tab; Icon: ComponentType<{ size?: number }> }[] = [
  { id: "route", Icon: RouteIcon },
  { id: "wander", Icon: WanderIcon },
  { id: "settings", Icon: SettingsIcon },
];

/** The bottom tab bar: Route, Wander, Settings. */
export function TabBar({ active, labels, onChange }: TabBarProps) {
  return (
    <nav className="kit-tabbar">
      {TABS.map(({ id, Icon }) => (
        <button
          key={id}
          type="button"
          className="kit-tab"
          aria-current={id === active ? "page" : undefined}
          data-active={id === active}
          onClick={() => onChange(id)}
        >
          {/* 22, not 24: the compact bar is 56 px tall (SPEC §4) */}
          <Icon size={22} />
          <span>{labels[id]}</span>
        </button>
      ))}
    </nav>
  );
}
