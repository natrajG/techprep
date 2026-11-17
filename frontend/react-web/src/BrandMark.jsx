import mark from "./assets/techprep-mark.svg";

export default function BrandMark({ className = "tp-brand-mark" }) {
  return <img src={mark} className={className} width="36" height="36" alt="" aria-hidden="true" />;
}
