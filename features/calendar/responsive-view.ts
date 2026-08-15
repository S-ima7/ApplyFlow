export type ResponsiveCalendarView = "timeGridDay" | "timeGridWeek";

type CalendarViewport = {
  matches: boolean;
  addEventListener: (
    type: "change",
    listener: (event: MediaQueryListEvent) => void
  ) => void;
  removeEventListener: (
    type: "change",
    listener: (event: MediaQueryListEvent) => void
  ) => void;
};

export function watchResponsiveCalendarView(
  viewport: CalendarViewport,
  changeView: (view: ResponsiveCalendarView) => void
) {
  const syncView = (matches: boolean) => {
    changeView(matches ? "timeGridDay" : "timeGridWeek");
  };
  const handleChange = (event: MediaQueryListEvent) => syncView(event.matches);

  syncView(viewport.matches);
  viewport.addEventListener("change", handleChange);

  return () => viewport.removeEventListener("change", handleChange);
}
