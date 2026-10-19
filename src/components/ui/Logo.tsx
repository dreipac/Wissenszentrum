import logo from "../../assets/logo.png";

interface LogoProps {
  /** Kantenlänge in Pixel */
  size?: number;
  className?: string;
}

/** Das Logo des Wissenszentrums (Quelle: branding/logo.png, hier auf 256 px verkleinert). */
export function Logo({ size = 24, className }: LogoProps) {
  return <img src={logo} alt="" width={size} height={size} className={className} draggable={false} aria-hidden="true" />;
}
