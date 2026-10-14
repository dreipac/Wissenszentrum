import { ButtonHTMLAttributes } from "react";

interface SecondaryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {}

/** Secondary-Button – Styles liegen global in styles/buttons.css */
export function SecondaryButton({
  className,
  type = "button",
  ...props
}: SecondaryButtonProps) {
  const classes = ["btn-secondary", className].filter(Boolean).join(" ");
  return <button type={type} className={classes} {...props} />;
}
