# `Voxaria-Web/src/components/ui/` — Design System & Atomic UI Primitives

## Functional Role
Atomic UI component library based on Radix UI headless primitives and Tailwind CSS (shadcn/ui design system). Provides accessible, unstyled-by-default primitives styled with Voxaria neon theme tokens, variant support via `class-variance-authority` (CVA), and utility class composition (`cn`).

## Table of Files

| File Name | Primary Purpose | Key Exports / Components / Hooks | Key Dependencies |
| :--- | :--- | :--- | :--- |
| `accordion.tsx` | Collapsible interactive disclosure panels. | `Accordion`, `AccordionItem`, `AccordionTrigger`, `AccordionContent` | `@radix-ui/react-accordion`, `lucide-react`, `@/lib/utils` |
| `alert-dialog.tsx` | Modal dialog interrupting the user with important content and confirmation. | `AlertDialog`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogAction`, etc. | `@radix-ui/react-alert-dialog`, `@/components/ui/button`, `@/lib/utils` |
| `alert.tsx` | Status callout banner for notifications, errors, and warnings. | `Alert`, `AlertTitle`, `AlertDescription`, `alertVariants` | `class-variance-authority`, `@/lib/utils` |
| `aspect-ratio.tsx` | Displays content within a fixed aspect ratio container. | `AspectRatio` | `@radix-ui/react-aspect-ratio` |
| `avatar.tsx` | User profile avatar with fallback image/letter handling. | `Avatar`, `AvatarImage`, `AvatarFallback` | `@radix-ui/react-avatar`, `@/lib/utils` |
| `badge.tsx` | Small status indicator or category tag pill. | `Badge`, `badgeVariants` | `class-variance-authority`, `@/lib/utils` |
| `breadcrumb.tsx` | Hierarchical site navigation breadcrumbs trail. | `Breadcrumb`, `BreadcrumbList`, `BreadcrumbItem`, `BreadcrumbLink`, etc. | `@radix-ui/react-slot`, `lucide-react`, `@/lib/utils` |
| `button.tsx` | Base interactive button with variant and sizing configurations. | `Button`, `buttonVariants` | `@radix-ui/react-slot`, `class-variance-authority`, `@/lib/utils` |
| `calendar.tsx` | Date picker / calendar component. | `Calendar` | `react-day-picker`, `@/components/ui/button`, `@/lib/utils` |
| `card.tsx` | Container surface with header, title, description, content, and footer sections. | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` | `@/lib/utils` |
| `carousel.tsx` | Horizontal sliding carousel with next/prev controls. | `Carousel`, `CarouselContent`, `CarouselItem`, `CarouselPrevious`, `CarouselNext` | `embla-carousel-react`, `lucide-react`, `@/components/ui/button`, `@/lib/utils` |
| `chart.tsx` | Responsive data visualization wrapper built on Recharts. | `ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartLegend`, etc. | `recharts`, `@/lib/utils` |
| `checkbox.tsx` | Tri-state or binary selection checkbox. | `Checkbox` | `@radix-ui/react-checkbox`, `lucide-react`, `@/lib/utils` |
| `collapsible.tsx` | Interactive element that expands/collapses secondary panels. | `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` | `@radix-ui/react-collapsible` |
| `command.tsx` | Fast, accessible cmdk command palette and search dialog. | `Command`, `CommandDialog`, `CommandInput`, `CommandList`, `CommandItem`, etc. | `cmdk`, `lucide-react`, `@/components/ui/dialog`, `@/lib/utils` |
| `context-menu.tsx` | Contextual right-click overlay menu. | `ContextMenu`, `ContextMenuTrigger`, `ContextMenuContent`, `ContextMenuItem`, etc. | `@radix-ui/react-context-menu`, `lucide-react`, `@/lib/utils` |
| `dialog.tsx` | Modal dialog overlay focused on primary tasks. | `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle`, etc. | `@radix-ui/react-dialog`, `lucide-react`, `@/lib/utils` |
| `drawer.tsx` | Slide-out sheet / drawer primitive (mobile-friendly). | `Drawer`, `DrawerTrigger`, `DrawerContent`, `DrawerHeader`, `DrawerFooter`, etc. | `vaul`, `@/lib/utils` |
| `dropdown-menu.tsx` | Dropdown action menu triggered by button clicks. | `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, etc. | `@radix-ui/react-dropdown-menu`, `lucide-react`, `@/lib/utils` |
| `form.tsx` | Accessible form wrapper integrating React Hook Form with UI labels/messages. | `useFormField`, `Form`, `FormItem`, `FormLabel`, `FormControl`, `FormMessage`, etc. | `@radix-ui/react-slot`, `react-hook-form`, `@/components/ui/label`, `@/lib/utils` |
| `hover-card.tsx` | Hover preview card for displaying additional context. | `HoverCard`, `HoverCardTrigger`, `HoverCardContent` | `@radix-ui/react-hover-card`, `@/lib/utils` |
| `input-otp.tsx` | One-time passcode / pin code segmented input field. | `InputOTP`, `InputOTPGroup`, `InputOTPSlot`, `InputOTPSeparator` | `input-otp`, `lucide-react`, `@/lib/utils` |
| `input.tsx` | Form text input element with standard styling. | `Input` (forwardRef) | `@/lib/utils` |
| `label.tsx` | Accessible form field label. | `Label`, `labelVariants` | `@radix-ui/react-label`, `class-variance-authority`, `@/lib/utils` |
| `menubar.tsx` | Desktop application style horizontal menubar. | `Menubar`, `MenubarMenu`, `MenubarTrigger`, `MenubarContent`, etc. | `@radix-ui/react-menubar`, `lucide-react`, `@/lib/utils` |
| `navigation-menu.tsx` | Top-level header navigation menu with mega-menu dropdown support. | `NavigationMenu`, `NavigationMenuList`, `NavigationMenuItem`, etc. | `@radix-ui/react-navigation-menu`, `lucide-react`, `@/lib/utils` |
| `pagination.tsx` | Multi-page numbered pagination controls. | `Pagination`, `PaginationContent`, `PaginationLink`, `PaginationNext`, etc. | `lucide-react`, `@/components/ui/button`, `@/lib/utils` |
| `popover.tsx` | Floating popover box anchored to an interactive element. | `Popover`, `PopoverTrigger`, `PopoverContent` | `@radix-ui/react-popover`, `@/lib/utils` |
| `progress.tsx` | Horizontal progress indicator bar. | `Progress` | `@radix-ui/react-progress`, `@/lib/utils` |
| `radio-group.tsx` | Radio selection button group. | `RadioGroup`, `RadioGroupItem` | `@radix-ui/react-radio-group`, `lucide-react`, `@/lib/utils` |
| `resizable.tsx` | Draggable split panels and resizable layout columns. | `ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle` | `react-resizable-panels`, `lucide-react`, `@/lib/utils` |
| `scroll-area.tsx` | Cross-browser custom styled scroll container. | `ScrollArea`, `ScrollBar` | `@radix-ui/react-scroll-area`, `@/lib/utils` |
| `select.tsx` | Select dropdown input with customizable option items. | `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`, etc. | `@radix-ui/react-select`, `lucide-react`, `@/lib/utils` |
| `separator.tsx` | Visual horizontal or vertical separator divider. | `Separator` | `@radix-ui/react-separator`, `@/lib/utils` |
| `sheet.tsx` | Side slide-in sheet / panel drawer (left/right/top/bottom). | `Sheet`, `SheetTrigger`, `SheetContent`, `SheetHeader`, `SheetFooter`, etc. | `@radix-ui/react-dialog`, `lucide-react`, `class-variance-authority`, `@/lib/utils` |
| `sidebar.tsx` | Collapsible, responsive app sidebar system with state context. | `SidebarProvider`, `Sidebar`, `SidebarTrigger`, `SidebarContent`, `useSidebar`, etc. | `@radix-ui/react-slot`, `lucide-react`, `@/hooks/use-mobile`, `@/lib/utils` |
| `skeleton.tsx` | Placeholder skeleton animation for loading states. | `Skeleton` | `@/lib/utils` |
| `slider.tsx` | Range slider control for volume, scrubbers, and audio settings. | `Slider` | `@radix-ui/react-slider`, `@/lib/utils` |
| `sonner.tsx` | Modern toast provider wrapper around Sonner toast engine. | `Toaster as Sonner` | `sonner` |
| `switch.tsx` | Toggle switch input. | `Switch` | `@radix-ui/react-switch`, `@/lib/utils` |
| `table.tsx` | Accessible table elements (Table, Header, Body, Row, Cell). | `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableCell`, etc. | `@/lib/utils` |
| `tabs.tsx` | Tabbed content container for multi-pane layouts. | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | `@radix-ui/react-tabs`, `@/lib/utils` |
| `textarea.tsx` | Multi-line text input field. | `Textarea` (forwardRef) | `@/lib/utils` |
| `toast.tsx` | Individual toast notifications with close button and action hooks. | `Toast`, `ToastAction`, `ToastClose`, `ToastTitle`, `ToastDescription` | `@radix-ui/react-toast`, `lucide-react`, `class-variance-authority`, `@/lib/utils` |
| `toaster.tsx` | Toast renderer mounting active toasts from `useToast`. | `Toaster` | `@/components/ui/toast`, `@/components/ui/use-toast` |
| `toggle-group.tsx` | Single or multi-select group of toggle buttons. | `ToggleGroup`, `ToggleGroupItem` | `@radix-ui/react-toggle-group`, `@/components/ui/toggle`, `@/lib/utils` |
| `toggle.tsx` | Two-state toggle button. | `Toggle`, `toggleVariants` | `@radix-ui/react-toggle`, `class-variance-authority`, `@/lib/utils` |
| `tooltip.tsx` | Floating hover tooltip bubble. | `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider` | `@radix-ui/react-tooltip`, `@/lib/utils` |
| `use-toast.ts` | Local re-export / implementation of toast dispatcher and hook. | `useToast`, `toast` | React state reducer |

## Common Error Scenarios & Troubleshooting Tips
- **Missing Provider Context**: Components like `TooltipContent` require an enclosing `<TooltipProvider>` (mounted globally in `App.tsx`). `Sidebar` requires `<SidebarProvider>`.
- **Ref Forwarding Failures**: All primitives use `React.forwardRef`. When using `asChild` with `Slot`, ensure direct child accepts and forwards refs and props.
- **Portals & Z-Index Clashes**: Dialog, Popover, Select, and DropdownMenu render into React portals (`document.body`). If modals are obscured by fixed headers, inspect z-index tokens in `index.css`.
- **Dual Toast Implementations**: The codebase contains both Radix-based `<Toaster />` (`use-toast.ts`) and Sonner `<Sonner />`. Verify which toast hook is imported (`useToast` vs Sonner's `toast`).

## Upstream / Downstream Dataflow
- **Upstream**: Relies on Radix UI primitive packages, Lucide icons, Tailwind utility classes, and `@/lib/utils` (`cn`).
- **Downstream**: Consumed by domain components (`components/karaoke/*`, `components/AuditLogViewer`), feature dialogs, and top-level pages (`pages/Index.tsx`).
