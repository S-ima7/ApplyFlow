import * as React from "react";
import { cn } from "@/lib/utils";

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => (
    <select
      className={cn(
        "h-11 min-w-0 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100",
        className
      )}
      ref={ref}
      {...props}
    >
      {children}
    </select>
  )
);

Select.displayName = "Select";

export { Select };
