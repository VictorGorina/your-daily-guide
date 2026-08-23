import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Botones del guideline (docs/design-guidelines.md §5): sin bordes ni
// sombras, radio 99px (pastilla), Figtree 600. Primario es el único naranja
// de la pantalla; secundario y outline se diferencian solo por fondo. Los
// tamaños "icon"/"icon-sm" son los circulares de acción (34px/30px) y llevan
// el hover de escala 1.08 que especifica esa sección.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-ui text-[13.5px] font-semibold cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "bg-secondary text-foreground hover:bg-accent",
        secondary: "bg-surface text-muted-foreground hover:text-primary",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-5 py-[13px]",
        sm: "h-9 px-4 text-xs",
        lg: "h-12 px-8",
        icon: "h-[34px] w-[34px] transition-transform duration-200 hover:scale-[1.08]",
        "icon-sm": "h-[30px] w-[30px] transition-transform duration-200 hover:scale-[1.08]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
