import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function compact<T>(items: Array<T | null | undefined>) {
  return items.filter((item): item is T => item != null);
}
