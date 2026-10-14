import type { ComponentProps } from "react";

type ButtonProps = ComponentProps<"button">;

/** Primary-Button – Styles liegen global in styles/buttons.css */
export function Button({ className, type = "button", ...props }: ButtonProps) {
  const classes = ["btn", className].filter(Boolean).join(" ");
  return <button type={type} className={classes} {...props} />;
}
