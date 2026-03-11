import React, { useEffect } from 'react';
import { useNotesAndCronsStore } from '../stores/useNotesAndCronsStore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';
import { StickyNote, Loader2 } from 'lucide-react';
import { Switch } from './ui/switch';

export const NotesPanel: React.FC = () => {
    const { notes, isLoading, fetchNotes, toggleNoteActive } = useNotesAndCronsStore();

    useEffect(() => {
        fetchNotes();
    }, [fetchNotes]);

    const activeNotes = notes.filter(n => Number(n.active) === 1);

    return (
        <Card className="border-none bg-background/50 backdrop-blur-xl shadow-2xl overflow-hidden group border border-white/10">
            <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="p-2 rounded-xl bg-primary/10 text-primary">
                            <StickyNote className="w-5 h-5" />
                        </div>
                        <div>
                            <CardTitle className="text-xl font-bold tracking-tight">Notas</CardTitle>
                            <CardDescription>Notas activas en el panel</CardDescription>
                        </div>
                    </div>
                    {isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                </div>
            </CardHeader>
            <CardContent>
                <ScrollArea className="h-[350px] pr-4">
                    <div className="space-y-4">
                        {activeNotes.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-[250px] text-muted-foreground space-y-2">
                                <StickyNote className="w-12 h-12 opacity-20" />
                                <p className="text-sm">No hay notas activas</p>
                                <p className="text-[10px] opacity-70">Usa el sistema para generar nuevas notas</p>
                            </div>
                        ) : (
                            activeNotes.map((note) => (
                                <div
                                    key={note.id}
                                    className="p-4 rounded-2xl border border-white/5 bg-card/40 hover:bg-card/60 transition-all duration-300 group/item relative overflow-hidden"
                                >
                                    <div className="absolute top-0 right-0 p-3 opacity-0 group-hover/item:opacity-100 transition-opacity">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Ocultar</span>
                                            <Switch
                                                checked={true}
                                                onCheckedChange={() => toggleNoteActive(note.id, false)}
                                                className="scale-75 data-[state=checked]:bg-primary"
                                            />
                                        </div>
                                    </div>
                                    <h4 className="font-semibold text-sm mb-1.5 line-clamp-1 pr-16">{note.title}</h4>
                                    <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
                                        {note.content}
                                    </p>
                                    <div className="mt-4 flex items-center justify-between">
                                        <Badge variant="secondary" className="text-[10px] px-2 py-0.5 bg-primary/10 text-primary border-none font-medium">
                                            NOTE
                                        </Badge>
                                        <span className="text-[10px] text-muted-foreground font-mono">
                                            {new Date(note.updatedAt * 1000).toLocaleDateString()}
                                        </span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </ScrollArea>
            </CardContent>
        </Card>
    );
};
