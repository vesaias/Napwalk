type ToastProps = { text: string };

/** The transient dark pill above the sheet: "Link copied", "Thanks — sent." */
export function Toast({ text }: ToastProps) {
  return (
    <div className="kit-toast" role="status" aria-live="polite">
      {text}
    </div>
  );
}
