/** Format proportions the way the paper does: 0.21, not 21%. */
export function fmtRate(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

export function fmtPpl(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(2);
}

export function fmtInt(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Math.round(value).toLocaleString("en-GB");
}

export function armColor(arm: string): string {
  const styles = getComputedStyle(document.documentElement);
  switch (arm) {
    case "replace":
      return styles.getPropertyValue("--arm-replace").trim() || "#c44e52";
    case "subsample":
      return styles.getPropertyValue("--arm-subsample").trim() || "#2c7fb8";
    case "accumulate":
      return styles.getPropertyValue("--arm-accumulate").trim() || "#2ca25f";
    default:
      return styles.getPropertyValue("--arm-shared").trim() || "#737373";
  }
}

export function armLabel(arm: string): string {
  switch (arm) {
    case "replace":
      return "replace";
    case "subsample":
      return "subsample";
    case "accumulate":
      return "accumulate";
    case "shared":
      return "shared (G0/G1)";
    default:
      return arm;
  }
}
