import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "rounded-2xl! border! border-[color:var(--toast-border,var(--border))]! bg-card! p-4! font-body! text-foreground! shadow-[0_20px_50px_-24px_var(--toast-glow,var(--primary))]!",
          title: "font-display! text-sm! font-semibold!",
          description: "font-body! text-xs! text-muted-foreground!",
          actionButton:
            "rounded-xl! bg-[color:var(--toast-action,var(--primary))]! px-3! py-1.5! font-body! text-xs! font-semibold! text-[color:var(--toast-action-fg,var(--primary-foreground))]! hover:brightness-110!",
          cancelButton: "rounded-xl! bg-muted! text-muted-foreground!",
          icon: "text-[color:var(--toast-icon,var(--primary))]!",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
