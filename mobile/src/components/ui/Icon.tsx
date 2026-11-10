import { Ionicons } from "@expo/vector-icons";
import { SymbolView, type SymbolViewProps } from "expo-symbols";
import type { ComponentProps } from "react";
import { Platform } from "react-native";

type SfName = SymbolViewProps["name"];
type IoName = ComponentProps<typeof Ionicons>["name"];

/** Jedes Symbol gibt es zweimal: als SF Symbol (iOS) und als Ionicon (Android, Web). */
const icons = {
  check: { sf: "checkmark", io: "checkmark" },
  circle: { sf: "circle", io: "ellipse-outline" },
  checkCircle: { sf: "checkmark.circle.fill", io: "checkmark-circle" },
  plus: { sf: "plus", io: "add" },
  chevronRight: { sf: "chevron.right", io: "chevron-forward" },
  chevronLeft: { sf: "chevron.left", io: "chevron-back" },
  calendar: { sf: "calendar", io: "calendar-outline" },
  clock: { sf: "clock", io: "time-outline" },
  location: { sf: "mappin.and.ellipse", io: "location-outline" },
  flag: { sf: "flag.fill", io: "flag" },
  note: { sf: "note.text", io: "document-text-outline" },
  pin: { sf: "pin.fill", io: "pin" },
  pinOff: { sf: "pin.slash", io: "pin-outline" },
  trash: { sf: "trash", io: "trash-outline" },
  search: { sf: "magnifyingglass", io: "search" },
  folder: { sf: "folder", io: "folder-outline" },
  flame: { sf: "flame.fill", io: "flame" },
  link: { sf: "link", io: "link-outline" },
  close: { sf: "xmark", io: "close" },
  tray: { sf: "tray", io: "file-tray-outline" },
  list: { sf: "list.bullet", io: "list" },
  minus: { sf: "minus", io: "remove" },
  today: { sf: "sun.max", io: "sunny-outline" },
  camera: { sf: "camera.fill", io: "camera" },
} as const satisfies Record<string, { sf: SfName; io: IoName }>;

export type IconName = keyof typeof icons;

interface IconProps {
  name: IconName;
  size?: number;
  color: string;
}

/** Symbol: auf iOS ein SF Symbol, sonst ein Ionicon. */
export function Icon({ name, size = 20, color }: IconProps) {
  const icon = icons[name];
  if (Platform.OS === "ios") return <SymbolView name={icon.sf} size={size} tintColor={color} resizeMode="scaleAspectFit" style={{ width: size, height: size }} />;
  return <Ionicons name={icon.io} size={size} color={color} />;
}
