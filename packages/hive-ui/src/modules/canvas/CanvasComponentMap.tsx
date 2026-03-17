import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Command, CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Menubar, MenubarContent, MenubarItem, MenubarMenu, MenubarSeparator, MenubarShortcut, MenubarTrigger } from "@/components/ui/menubar";
import { NavigationMenu, NavigationMenuContent, NavigationMenuItem, NavigationMenuLink, NavigationMenuList, NavigationMenuTrigger } from "@/components/ui/navigation-menu";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Breadcrumb, BreadcrumbEllipsis, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Calendar } from "@/components/ui/calendar";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } from "@/components/ui/input-otp";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend
} from "recharts";

export interface CanvasComponentProps {
  type: string;
  props: Record<string, unknown>;
  id: string;
  onInteraction?: (id: string, action: string, data?: unknown) => void;
}

function renderAlert(props: Record<string, unknown>) {
  return (
    <Alert variant={(props.variant as "default" | "destructive") || "default"} className={props.className as string}>
      {props.title && <AlertTitle>{String(props.title)}</AlertTitle>}
      {props.description && <AlertDescription>{String(props.description)}</AlertDescription>}
      {props.children && <div>{String(props.children)}</div>}
    </Alert>
  );
}

function renderButton(props: Record<string, unknown>) {
  return (
    <Button
      variant={props.variant as "default" | "destructive" | "outline" | "secondary" | "ghost" | "link"}
      size={props.size as "default" | "sm" | "lg" | "icon"}
      disabled={props.disabled as boolean}
      className={props.className as string}
    >
      {(props.label as string) || (props.children as string)}
    </Button>
  );
}

function renderBadge(props: Record<string, unknown>) {
  return (
    <Badge variant={(props.variant as "default" | "destructive" | "outline" | "secondary") || "default"} className={props.className as string}>
      {String(props.children || props.label || "")}
    </Badge>
  );
}

function renderCard(props: Record<string, unknown>) {
  return (
    <Card className={props.className as string || "bg-background/60 backdrop-blur-md border-primary/20"}>
      {props.title && (
        <CardHeader>
          <CardTitle>{props.title as string}</CardTitle>
          {props.description && <CardDescription>{props.description as string}</CardDescription>}
        </CardHeader>
      )}
      <CardContent>
        {props.children ? <div>{String(props.children)}</div> : null}
      </CardContent>
      {props.footer && <CardFooter><div>{String(props.footer)}</div></CardFooter>}
    </Card>
  );
}

function renderInput(props: Record<string, unknown>) {
  return (
    <Input
      type={props.type as string}
      placeholder={props.placeholder as string}
      value={props.value as string}
      disabled={props.disabled as boolean}
      className={props.className as string}
    />
  );
}

function renderLabel(props: Record<string, unknown>) {
  return (
    <Label htmlFor={props.htmlFor as string} className={props.className as string}>
      {String(props.children || props.label || "")}
    </Label>
  );
}

function renderTextarea(props: Record<string, unknown>) {
  return (
    <Textarea
      placeholder={props.placeholder as string}
      value={props.value as string}
      disabled={props.disabled as boolean}
      className={props.className as string}
      rows={props.rows as number}
    />
  );
}

function renderCheckbox(props: Record<string, unknown>) {
  return (
    <Checkbox
      checked={props.checked as boolean}
      disabled={props.disabled as boolean}
    />
  );
}

function renderSwitch(props: Record<string, unknown>) {
  return (
    <Switch
      checked={props.checked as boolean}
      disabled={props.disabled as boolean}
    />
  );
}

function renderRadioGroup(props: Record<string, unknown>) {
  return (
    <RadioGroup value={props.value as string}>
      {(props.options as Array<{ value: string; label: string }>)?.map((opt) => (
        <div key={opt.value} className="flex items-center space-x-2">
          <RadioGroupItem value={opt.value} />
          <Label>{opt.label}</Label>
        </div>
      ))}
    </RadioGroup>
  );
}

function renderSelect(props: Record<string, unknown>) {
  return (
    <Select value={props.value as string}>
      <SelectTrigger className={props.className as string}>
        <SelectValue placeholder={props.placeholder as string} />
      </SelectTrigger>
      <SelectContent>
        {(props.options as Array<{ value: string; label: string }>)?.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function renderSlider(props: Record<string, unknown>) {
  return (
    <Slider
      value={(props.value as number[]) || [50]}
      min={props.min as number}
      max={props.max as number}
      step={props.step as number}
    />
  );
}

function renderProgress(props: Record<string, unknown>) {
  return <Progress value={props.value as number} className={props.className as string} />;
}

function renderTable(props: Record<string, unknown>) {
  return (
    <Card className="border-primary/10 bg-background/40">
      {props.title && (
        <CardHeader>
          <CardTitle className="text-md font-semibold">{props.title as string}</CardTitle>
        </CardHeader>
      )}
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              {(props.columns as Array<{ header: string; key: string }>)?.map((col) => (
                <TableHead key={col.key} className="font-bold text-primary">{col.header}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(props.data as Array<Record<string, unknown>>)?.map((row, rowIdx) => (
              <TableRow key={rowIdx} className="hover:bg-primary/5 transition-colors">
                {(props.columns as Array<{ key: string }>)?.map((col, colIdx) => (
                  <TableCell key={colIdx} className="text-sm">
                    {String(row[col.key])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function renderTabs(props: Record<string, unknown>) {
  const tabs = (props.tabs as Array<{ value: string; label: string; content: string }>) || [];
  const defaultValue = tabs[0]?.value;
  return (
    <Tabs defaultValue={props.defaultValue as string || defaultValue}>
      <TabsList>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value}>
          {tab.content ? (
            <div className="prose prose-invert max-w-none text-sm">
              <ReactMarkdown>{String(tab.content)}</ReactMarkdown>
            </div>
          ) : null}
        </TabsContent>
      ))}
    </Tabs>
  );
}

function renderAvatar(props: Record<string, unknown>) {
  return (
    <Avatar className={props.className as string}>
      {props.src && <AvatarImage src={props.src as string} />}
      <AvatarFallback>{props.fallback as string}</AvatarFallback>
    </Avatar>
  );
}

function renderSeparator(props: Record<string, unknown>) {
  return <Separator orientation={props.orientation as "horizontal" | "vertical"} className={props.className as string} />;
}

function renderSkeleton(props: Record<string, unknown>) {
  return <Skeleton className={props.className as string} />;
}

function renderScrollArea(props: Record<string, unknown>) {
  return (
    <ScrollArea className={props.className as string} style={{ height: props.height as string }}>
      {props.children ? <div>{String(props.children)}</div> : null}
    </ScrollArea>
  );
}

function renderTooltip(props: Record<string, unknown>) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>{String(props.children || props.trigger || "Hover")}</span>
        </TooltipTrigger>
        <TooltipContent>{String(props.content || "")}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function renderDialog(props: Record<string, unknown>) {
  const [open, setOpen] = useState(true);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {props.trigger && (
        <DialogTrigger asChild>
          <Button variant="outline">{String(props.trigger)}</Button>
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{String(props.title || "")}</DialogTitle>
          {props.description && <DialogDescription>{String(props.description)}</DialogDescription>}
        </DialogHeader>
        {props.children && <div className="py-2">{String(props.children)}</div>}
      </DialogContent>
    </Dialog>
  );
}

function renderDrawer(props: Record<string, unknown>) {
  const [open, setOpen] = useState(true);
  return (
    <Drawer open={open} onOpenChange={setOpen}>
      {props.trigger && (
        <DrawerTrigger asChild>
          <Button variant="outline">{String(props.trigger)}</Button>
        </DrawerTrigger>
      )}
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{String(props.title || "")}</DrawerTitle>
          {props.description && <DrawerDescription>{String(props.description)}</DrawerDescription>}
        </DrawerHeader>
        {props.children && <div className="px-4 pb-4">{String(props.children)}</div>}
      </DrawerContent>
    </Drawer>
  );
}

function renderSheet(props: Record<string, unknown>) {
  const [open, setOpen] = useState(true);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {props.trigger && (
        <SheetTrigger asChild>
          <Button variant="outline">{String(props.trigger)}</Button>
        </SheetTrigger>
      )}
      <SheetContent side={props.side as "top" | "bottom" | "left" | "right"}>
        <SheetHeader>
          <SheetTitle>{String(props.title || "")}</SheetTitle>
          {props.description && <SheetDescription>{String(props.description)}</SheetDescription>}
        </SheetHeader>
        {props.children && <div className="py-2">{String(props.children)}</div>}
      </SheetContent>
    </Sheet>
  );
}

function renderDropdownMenu(props: Record<string, unknown>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">{String(props.trigger || "Open Menu")}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {props.label && <DropdownMenuLabel>{String(props.label)}</DropdownMenuLabel>}
        {(props.items as Array<{ label: string; separator?: boolean }>)?.map((item, idx) => (
          item.separator
            ? <DropdownMenuSeparator key={idx} />
            : <DropdownMenuItem key={idx}>{item.label}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function renderCommand(props: Record<string, unknown>) {
  return (
    <Command>
      <CommandInput placeholder={props.placeholder as string || "Search..."} />
      <CommandList>
        <CommandEmpty>{String(props.empty || "No results found.")}</CommandEmpty>
        {(props.items as Array<{ label: string; items: Array<{ label: string }> }>)?.map((group, gIdx) => (
          <CommandGroup key={gIdx} heading={group.label}>
            {group.items?.map((item, itemIdx) => (
              <CommandItem key={itemIdx}>
                {item.label}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
}

function renderContextMenu(props: Record<string, unknown>) {
  return (
    <ContextMenu>
      <ContextMenuTrigger className="flex h-16 w-full items-center justify-center rounded-md border border-dashed text-sm">
        {String(props.trigger || "Right click here")}
      </ContextMenuTrigger>
      <ContextMenuContent>
        {props.label && <ContextMenuLabel>{String(props.label)}</ContextMenuLabel>}
        {(props.items as Array<{ label: string; separator?: boolean }>)?.map((item, idx) => (
          item.separator
            ? <ContextMenuSeparator key={idx} />
            : <ContextMenuItem key={idx}>{item.label}</ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function renderMenubar(props: Record<string, unknown>) {
  return (
    <Menubar>
      {(props.menus as Array<{ label: string; items: Array<{ label: string; shortcut?: string; separator?: boolean }> }>)?.map((menu, mIdx) => (
        <MenubarMenu key={mIdx}>
          <MenubarTrigger>{menu.label}</MenubarTrigger>
          <MenubarContent>
            {menu.items?.map((item, itemIdx) => (
              item.separator
                ? <MenubarSeparator key={itemIdx} />
                : (
                  <MenubarItem key={itemIdx}>
                    {item.label}
                    {item.shortcut && <MenubarShortcut>{item.shortcut}</MenubarShortcut>}
                  </MenubarItem>
                )
            ))}
          </MenubarContent>
        </MenubarMenu>
      ))}
    </Menubar>
  );
}

function renderNavigationMenu(props: Record<string, unknown>) {
  return (
    <NavigationMenu>
      <NavigationMenuList>
        {(props.items as Array<{ label: string; content: string; href?: string }>)?.map((item, idx) => (
          item.content
            ? (
              <NavigationMenuItem key={idx}>
                <NavigationMenuTrigger>{item.label}</NavigationMenuTrigger>
                <NavigationMenuContent>
                  <div className="p-4 w-48">{String(item.content)}</div>
                </NavigationMenuContent>
              </NavigationMenuItem>
            )
            : (
              <NavigationMenuItem key={idx}>
                <NavigationMenuLink href={item.href || "#"} className="px-3 py-2 text-sm font-medium">
                  {item.label}
                </NavigationMenuLink>
              </NavigationMenuItem>
            )
        ))}
      </NavigationMenuList>
    </NavigationMenu>
  );
}

function renderAccordion(props: Record<string, unknown>) {
  return (
    <Accordion type={(props.type as "single" | "multiple") || "single"} collapsible={props.collapsible !== false}>
      {(props.items as Array<{ value: string; title: string; content: string }>)?.map((item) => (
        <AccordionItem key={item.value} value={item.value}>
          <AccordionTrigger>{item.title}</AccordionTrigger>
          <AccordionContent>
            {item.content ? (
              <div className="prose prose-invert max-w-none text-sm">
                <ReactMarkdown>{String(item.content)}</ReactMarkdown>
              </div>
            ) : null}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

function renderCollapsible(props: Record<string, unknown>) {
  const [open, setOpen] = useState(props.open !== false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-between">
          {String(props.trigger || "Toggle")}
          <span>{open ? "▲" : "▼"}</span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        {props.children ? (
          <div className="prose prose-invert max-w-none text-sm px-2">
            <ReactMarkdown>{String(props.children)}</ReactMarkdown>
          </div>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

function renderResizable(props: Record<string, unknown>) {
  return (
    <ResizablePanelGroup direction={(props.direction as "horizontal" | "vertical") || "horizontal"} className="min-h-32 rounded-lg border">
      {(props.panels as Array<{ size: number; content: string }>)?.map((panel, idx, arr) => (
        <React.Fragment key={idx}>
          <ResizablePanel defaultSize={panel.size}>
            <div className="flex h-full items-center justify-center p-3 text-sm">
              {String(panel.content || "")}
            </div>
          </ResizablePanel>
          {idx < arr.length - 1 && <ResizableHandle />}
        </React.Fragment>
      ))}
    </ResizablePanelGroup>
  );
}

function renderBreadcrumb(props: Record<string, unknown>) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {(props.items as Array<{ label: string; href?: string }>)?.map((item, idx) => (
          <React.Fragment key={`${item.label}-${item.href ?? ""}`}>
            <BreadcrumbItem>
              {item.href ? <BreadcrumbLink href={item.href}>{item.label}</BreadcrumbLink> : <BreadcrumbPage>{item.label}</BreadcrumbPage>}
            </BreadcrumbItem>
            {idx < (props.items as Array<unknown>).length - 1 && <BreadcrumbSeparator />}
          </React.Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function renderPagination(props: Record<string, unknown>) {
  return (
    <Pagination>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious href="#" />
        </PaginationItem>
        {(props.items as Array<{ label: string; value: string; active?: boolean }>)?.map((item) => (
          <PaginationItem key={item.value}>
            <PaginationLink href="#" isActive={item.active}>{item.label}</PaginationLink>
          </PaginationItem>
        ))}
        <PaginationItem>
          <PaginationNext href="#" />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}

function renderToggle(props: Record<string, unknown>) {
  return (
    <Toggle pressed={props.pressed as boolean}>
      {String(props.children || props.label || "Toggle")}
    </Toggle>
  );
}

function renderToggleGroup(props: Record<string, unknown>) {
  return (
    <ToggleGroup type="single" value={String(props.value || "")}>
      {(props.items as Array<{ value: string; label: string }>)?.map((item) => (
        <ToggleGroupItem key={item.value} value={item.value}>
          {item.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function renderCalendar(props: Record<string, unknown>) {
  return (
    <Calendar
      mode={props.mode as "single" | "multiple" | "range"}
      disabled={props.disabled as boolean}
    />
  );
}

function renderAspectRatio(props: Record<string, unknown>) {
  return (
    <AspectRatio ratio={(props.ratio as number) || 16 / 9} className={props.className as string}>
      {props.src
        ? <img src={props.src as string} alt={props.alt as string || ""} className="w-full h-full object-cover rounded-md" />
        : props.children ? <div className="flex items-center justify-center w-full h-full">{String(props.children)}</div> : null
      }
    </AspectRatio>
  );
}

function renderHoverCard(props: Record<string, unknown>) {
  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <span className="cursor-pointer underline decoration-dotted">
          {String(props.children || props.trigger || "Hover me")}
        </span>
      </HoverCardTrigger>
      <HoverCardContent>
        {String(props.content || "")}
      </HoverCardContent>
    </HoverCard>
  );
}

function renderInputOTP(props: Record<string, unknown>) {
  const maxLength = (props.maxLength as number) || 6;
  return (
    <InputOTP maxLength={maxLength} value={props.value as string}>
      <InputOTPGroup>
        {Array.from({ length: maxLength }).map((_, idx) => (
          <InputOTPSlot key={idx} index={idx} />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}

function renderMarkdown(props: Record<string, unknown>) {
  return (
    <div className="prose prose-invert max-w-none p-4 bg-background/40 rounded-xl border">
      <ReactMarkdown>{props.content as string}</ReactMarkdown>
    </div>
  );
}

// ─── NEW: alert-dialog ───────────────────────────────────────────────────────

function renderAlertDialog(props: Record<string, unknown>) {
  const [open, setOpen] = useState(true);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{String(props.title || "Are you sure?")}</AlertDialogTitle>
          {props.description && (
            <AlertDialogDescription>{String(props.description)}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{String(props.cancelLabel || "Cancel")}</AlertDialogCancel>
          <AlertDialogAction>{String(props.actionLabel || "Continue")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── NEW: carousel ────────────────────────────────────────────────────────────

function renderCarousel(props: Record<string, unknown>) {
  const items = (props.items as Array<{ title?: string; content?: string; image?: string }>) || [];
  return (
    <Carousel orientation={(props.orientation as "horizontal" | "vertical") || "horizontal"} className="w-full max-w-sm mx-auto">
      <CarouselContent>
        {items.map((item, idx) => (
          <CarouselItem key={idx}>
            <Card>
              <CardContent className="flex flex-col items-center justify-center p-6 gap-2">
                {item.image && <img src={item.image} alt={item.title || ""} className="max-h-32 object-contain rounded" />}
                {item.title && <p className="font-semibold text-sm">{item.title}</p>}
                {item.content && <p className="text-xs text-muted-foreground text-center">{item.content}</p>}
              </CardContent>
            </Card>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  );
}

// ─── NEW: chart ───────────────────────────────────────────────────────────────

const DEFAULT_CHART_COLORS = ["hsl(var(--primary))", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

function renderChart(props: Record<string, unknown>) {
  const type = (props.type as string) || "bar";
  const data = (props.data as Array<Record<string, number | string>>) || [];
  const xKey = (props.xKey as string) || "name";
  const keys = (props.keys as string[]) || [];
  const colors = (props.colors as string[]) || DEFAULT_CHART_COLORS;

  const chartContent = (() => {
    if (type === "bar") {
      return (
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <RechartsTooltip />
          {keys.length > 1 && <Legend />}
          {keys.map((key, idx) => (
            <Bar key={key} dataKey={key} fill={colors[idx % colors.length]} radius={[4, 4, 0, 0]} />
          ))}
        </BarChart>
      );
    }
    if (type === "line") {
      return (
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <RechartsTooltip />
          {keys.length > 1 && <Legend />}
          {keys.map((key, idx) => (
            <Line key={key} type="monotone" dataKey={key} stroke={colors[idx % colors.length]} strokeWidth={2} dot={{ r: 4 }} />
          ))}
        </LineChart>
      );
    }
    if (type === "area") {
      return (
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <RechartsTooltip />
          {keys.length > 1 && <Legend />}
          {keys.map((key, idx) => (
            <Area key={key} type="monotone" dataKey={key} stroke={colors[idx % colors.length]} fill={colors[idx % colors.length]} fillOpacity={0.2} strokeWidth={2} />
          ))}
        </AreaChart>
      );
    }
    if (type === "pie") {
      const pieKey = keys[0] || "value";
      return (
        <PieChart>
          <Pie data={data} dataKey={pieKey} nameKey={xKey} cx="50%" cy="50%" outerRadius={80} label>
            {data.map((_, idx) => (
              <Cell key={idx} fill={colors[idx % colors.length]} />
            ))}
          </Pie>
          <RechartsTooltip />
          <Legend />
        </PieChart>
      );
    }
    return null;
  })();

  return (
    <Card className="bg-background/60 border-primary/20">
      {props.title && (
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">{String(props.title)}</CardTitle>
        </CardHeader>
      )}
      <CardContent className="pt-0">
        <ResponsiveContainer width="100%" height={260}>
          {chartContent || <BarChart data={[]} />}
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ─── NEW: form ────────────────────────────────────────────────────────────────

function renderForm(props: Record<string, unknown>) {
  type FieldDef = {
    name: string;
    label: string;
    type: "text" | "number" | "email" | "textarea" | "select" | "checkbox";
    placeholder?: string;
    options?: Array<{ value: string; label: string }>;
  };
  const fields = (props.fields as FieldDef[]) || [];

  return (
    <Card className="bg-background/60 border-primary/20">
      {props.title && (
        <CardHeader>
          <CardTitle className="text-sm font-semibold">{String(props.title)}</CardTitle>
        </CardHeader>
      )}
      <CardContent className="space-y-4">
        {fields.map((field) => (
          <div key={field.name} className="space-y-1">
            {field.type !== "checkbox" && (
              <Label htmlFor={field.name}>{field.label}</Label>
            )}
            {field.type === "textarea" ? (
              <Textarea id={field.name} placeholder={field.placeholder} />
            ) : field.type === "select" ? (
              <Select>
                <SelectTrigger id={field.name}>
                  <SelectValue placeholder={field.placeholder || `Select ${field.label}`} />
                </SelectTrigger>
                <SelectContent>
                  {field.options?.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : field.type === "checkbox" ? (
              <div className="flex items-center gap-2">
                <Checkbox id={field.name} />
                <Label htmlFor={field.name}>{field.label}</Label>
              </div>
            ) : (
              <Input id={field.name} type={field.type} placeholder={field.placeholder} />
            )}
          </div>
        ))}
      </CardContent>
      <CardFooter>
        <Button className="w-full">{String(props.submitLabel || "Submit")}</Button>
      </CardFooter>
    </Card>
  );
}

// ─── NEW: popover ─────────────────────────────────────────────────────────────

function renderPopover(props: Record<string, unknown>) {
  const [open, setOpen] = useState(true);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline">{String(props.triggerLabel || "Open")}</Button>
      </PopoverTrigger>
      <PopoverContent className="w-64">
        {props.content ? (
          <div className="prose prose-invert max-w-none text-sm">
            <ReactMarkdown>{String(props.content)}</ReactMarkdown>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

// ─── NEW: bee-loader ──────────────────────────────────────────────────────────

function renderBeeLoader(props: Record<string, unknown>) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-6">
      <div className="animate-bounce">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Body */}
          <ellipse cx="24" cy="28" rx="12" ry="10" fill="#F59E0B" />
          {/* Stripes */}
          <rect x="14" y="26" width="20" height="3" rx="1" fill="#1C1917" opacity="0.6" />
          <rect x="14" y="31" width="20" height="3" rx="1" fill="#1C1917" opacity="0.6" />
          {/* Head */}
          <ellipse cx="24" cy="18" rx="7" ry="7" fill="#F59E0B" />
          {/* Eyes */}
          <circle cx="21" cy="17" r="1.5" fill="#1C1917" />
          <circle cx="27" cy="17" r="1.5" fill="#1C1917" />
          {/* Antennae */}
          <line x1="22" y1="11" x2="18" y2="7" stroke="#1C1917" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="26" y1="11" x2="30" y2="7" stroke="#1C1917" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="18" cy="7" r="1.5" fill="#1C1917" />
          <circle cx="30" cy="7" r="1.5" fill="#1C1917" />
          {/* Wings */}
          <ellipse cx="14" cy="22" rx="7" ry="4" fill="white" opacity="0.7" transform="rotate(-20 14 22)" />
          <ellipse cx="34" cy="22" rx="7" ry="4" fill="white" opacity="0.7" transform="rotate(20 34 22)" />
          {/* Stinger */}
          <path d="M24 38 L21 44 L24 42 L27 44 Z" fill="#F59E0B" />
        </svg>
      </div>
      {props.message && (
        <p className="text-sm text-muted-foreground animate-pulse">{String(props.message)}</p>
      )}
    </div>
  );
}

function renderCustom(props: Record<string, unknown>) {
  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <div className="mb-2 text-[10px] font-bold uppercase text-muted-foreground">JSON Data</div>
      <pre className="overflow-auto text-[10px] text-muted-foreground/80">
        {JSON.stringify(props, null, 2)}
      </pre>
    </div>
  );
}

export const CanvasComponentMap: Record<string, (props: Record<string, unknown>) => React.ReactNode> = {
  alert: renderAlert,
  "alert-dialog": renderAlertDialog,
  button: renderButton,
  badge: renderBadge,
  card: renderCard,
  carousel: renderCarousel,
  chart: renderChart,
  input: renderInput,
  label: renderLabel,
  textarea: renderTextarea,
  checkbox: renderCheckbox,
  switch: renderSwitch,
  "radio-group": renderRadioGroup,
  select: renderSelect,
  slider: renderSlider,
  progress: renderProgress,
  table: renderTable,
  tabs: renderTabs,
  avatar: renderAvatar,
  separator: renderSeparator,
  skeleton: renderSkeleton,
  "scroll-area": renderScrollArea,
  tooltip: renderTooltip,
  dialog: renderDialog,
  drawer: renderDrawer,
  sheet: renderSheet,
  "dropdown-menu": renderDropdownMenu,
  command: renderCommand,
  "context-menu": renderContextMenu,
  menubar: renderMenubar,
  "navigation-menu": renderNavigationMenu,
  accordion: renderAccordion,
  collapsible: renderCollapsible,
  resizable: renderResizable,
  breadcrumb: renderBreadcrumb,
  pagination: renderPagination,
  toggle: renderToggle,
  "toggle-group": renderToggleGroup,
  calendar: renderCalendar,
  "aspect-ratio": renderAspectRatio,
  "hover-card": renderHoverCard,
  "input-otp": renderInputOTP,
  form: renderForm,
  popover: renderPopover,
  "bee-loader": renderBeeLoader,
  markdown: renderMarkdown,
  custom: renderCustom,
};

export function getCanvasComponent(type: string): (props: Record<string, unknown>) => React.ReactNode {
  return CanvasComponentMap[type] || renderCustom;
}
