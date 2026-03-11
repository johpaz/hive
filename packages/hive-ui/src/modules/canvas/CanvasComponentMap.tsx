import React from "react";
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
      {props.children as React.ReactNode}
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
      {(props.children as React.ReactNode) || (props.label as string)}
    </Button>
  );
}

function renderBadge(props: Record<string, unknown>) {
  return (
    <Badge variant={(props.variant as "default" | "destructive" | "outline" | "secondary") || "default"} className={props.className as string}>
      {props.children as React.ReactNode}
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
      <CardContent>{props.children as React.ReactNode}</CardContent>
      {props.footer && <CardFooter>{props.footer as React.ReactNode}</CardFooter>}
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
      {props.children as React.ReactNode}
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
    <RadioGroup value={props.value as string} onValueChange={props.onValueChange as (value: string) => void}>
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
    <Select value={props.value as string} onValueChange={props.onValueChange as (value: string) => void}>
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
      onValueChange={props.onValueChange as (value: number[]) => void}
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
  return (
    <Tabs value={props.value as string} onValueChange={props.onValueChange as (value: string) => void}>
      <TabsList>
        {(props.tabs as Array<{ value: string; label: string }>)?.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {(props.tabs as Array<{ value: string; content: React.ReactNode }>)?.map((tab) => (
        <TabsContent key={tab.value} value={tab.value}>
          {tab.content}
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
      {props.children as React.ReactNode}
    </ScrollArea>
  );
}

function renderTooltip(props: Record<string, unknown>) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>{props.children as React.ReactNode}</TooltipTrigger>
        <TooltipContent>{props.content as React.ReactNode}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function renderDialog(props: Record<string, unknown>) {
  return (
    <Dialog open={props.open as boolean} onOpenChange={props.onOpenChange as (open: boolean) => void}>
      <DialogTrigger>{props.trigger as React.ReactNode}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.title as string}</DialogTitle>
          {props.description && <DialogDescription>{props.description as string}</DialogDescription>}
        </DialogHeader>
        {props.children as React.ReactNode}
      </DialogContent>
    </Dialog>
  );
}

function renderDrawer(props: Record<string, unknown>) {
  return (
    <Drawer open={props.open as boolean} onOpenChange={props.onOpenChange as (open: boolean) => void}>
      <DrawerTrigger>{props.trigger as React.ReactNode}</DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{props.title as string}</DrawerTitle>
          {props.description && <DrawerDescription>{props.description as string}</DrawerDescription>}
        </DrawerHeader>
        <DrawerFooter>{props.children as React.ReactNode}</DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function renderSheet(props: Record<string, unknown>) {
  return (
    <Sheet open={props.open as boolean} onOpenChange={props.onOpenChange as (open: boolean) => void}>
      <SheetTrigger>{props.trigger as React.ReactNode}</SheetTrigger>
      <SheetContent side={props.side as "top" | "bottom" | "left" | "right"}>
        <SheetHeader>
          <SheetTitle>{props.title as string}</SheetTitle>
          {props.description && <SheetDescription>{props.description as string}</SheetDescription>}
        </SheetHeader>
        {props.children as React.ReactNode}
      </SheetContent>
    </Sheet>
  );
}

function renderDropdownMenu(props: Record<string, unknown>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>{props.trigger as React.ReactNode}</DropdownMenuTrigger>
      <DropdownMenuContent>
        {(props.items as Array<{ label: string; onClick: () => void }>)?.map((item) => (
          <DropdownMenuItem key={item.label} onClick={item.onClick}>
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function renderCommand(props: Record<string, unknown>) {
  return (
    <Command>
      <CommandInput placeholder={props.placeholder as string} />
      <CommandList>
        {(props.items as Array<{ label: string; items: Array<{ label: string; onSelect: () => void }> }>)?.map((group) => (
          <CommandGroup key={group.label} heading={group.label}>
            {group.items?.map((item, itemIdx) => (
              <CommandItem key={itemIdx} onSelect={item.onSelect}>
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
      <ContextMenuTrigger>{props.children as React.ReactNode}</ContextMenuTrigger>
      <ContextMenuContent>
        {(props.items as Array<{ label: string; onClick: () => void }>)?.map((item) => (
          <ContextMenuItem key={item.label} onClick={item.onClick}>
            {item.label}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function renderMenubar(props: Record<string, unknown>) {
  return (
    <Menubar>
      {(props.menus as Array<{ label: string; items: Array<{ label: string; onClick: () => void }> }>)?.map((menu) => (
        <MenubarMenu key={menu.label}>
          <MenubarTrigger>{menu.label}</MenubarTrigger>
          <MenubarContent>
            {menu.items?.map((item, itemIdx) => (
              <MenubarItem key={itemIdx} onClick={item.onClick}>
                {item.label}
              </MenubarItem>
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
        {(props.items as Array<{ label: string; content: React.ReactNode }>)?.map((item) => (
          <NavigationMenuItem key={item.label}>
            <NavigationMenuTrigger>{item.label}</NavigationMenuTrigger>
            <NavigationMenuContent>{item.content}</NavigationMenuContent>
          </NavigationMenuItem>
        ))}
      </NavigationMenuList>
    </NavigationMenu>
  );
}

function renderAccordion(props: Record<string, unknown>) {
  return (
    <Accordion type={props.type as "single" | "multiple"} collapsible={props.collapsible as boolean}>
      {(props.items as Array<{ value: string; title: string; content: React.ReactNode }>)?.map((item) => (
        <AccordionItem key={item.value} value={item.value}>
          <AccordionTrigger>{item.title}</AccordionTrigger>
          <AccordionContent>{item.content}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

function renderCollapsible(props: Record<string, unknown>) {
  return (
    <Collapsible open={props.open as boolean} onOpenChange={props.onOpenChange as (open: boolean) => void}>
      <CollapsibleTrigger>{props.trigger as React.ReactNode}</CollapsibleTrigger>
      <CollapsibleContent>{props.children as React.ReactNode}</CollapsibleContent>
    </Collapsible>
  );
}

function renderResizable(props: Record<string, unknown>) {
  return (
    <ResizablePanelGroup direction={props.direction as "horizontal" | "vertical"}>
      {(props.panels as Array<{ size: number; content: React.ReactNode }>)?.map((panel, idx) => (
        <React.Fragment key={`${panel.size}-${idx}`}>
          <ResizablePanel defaultSize={panel.size}>{panel.content}</ResizablePanel>
          {idx < (props.panels as Array<unknown>).length - 1 && <ResizableHandle />}
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
        <PaginationPrevious onClick={props.onPrevious as () => void} />
        {(props.items as Array<{ label: string; value: string }>)?.map((item) => (
          <PaginationItem key={item.value}>
            <PaginationLink>{item.label}</PaginationLink>
          </PaginationItem>
        ))}
        <PaginationNext onClick={props.onNext as () => void} />
      </PaginationContent>
    </Pagination>
  );
}

function renderToggle(props: Record<string, unknown>) {
  return (
    <Toggle pressed={props.pressed as boolean} onPressedChange={props.onPressedChange as (pressed: boolean) => void}>
      {props.children as React.ReactNode}
    </Toggle>
  );
}

function renderToggleGroup(props: Record<string, unknown>) {
  return (
    <ToggleGroup type="single" value={String(props.value || "")} onValueChange={() => {}}>
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
    <AspectRatio ratio={props.ratio as number} className={props.className as string}>
      {props.children as React.ReactNode}
    </AspectRatio>
  );
}

function renderHoverCard(props: Record<string, unknown>) {
  return (
    <HoverCard>
      <HoverCardTrigger>{props.children as React.ReactNode}</HoverCardTrigger>
      <HoverCardContent>{props.content as React.ReactNode}</HoverCardContent>
    </HoverCard>
  );
}

function renderInputOTP(props: Record<string, unknown>) {
  const maxLength = (props.maxLength as number) || 6;
  return (
    <InputOTP
      maxLength={maxLength}
      value={props.value as string}
      onChange={props.onChange as (value: string) => void}
    >
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
  button: renderButton,
  badge: renderBadge,
  card: renderCard,
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
  markdown: renderMarkdown,
  custom: renderCustom,
};

export function getCanvasComponent(type: string): (props: Record<string, unknown>) => React.ReactNode {
  return CanvasComponentMap[type] || renderCustom;
}
