import React, { useEffect } from 'react';
import { useNotesAndCronsStore } from '../stores/useNotesAndCronsStore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';
import { StickyNote, Loader2 } from 'lucide-react';

export const NotesPanel: React.FC = () => {
    const { notes, isLoading, fetchNotes } = useNotesAndCronsStore();

    useEffect(() => {
        fetchNotes();
    }, [fetchNotes]);

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
                            <CardDescription>Scratchpad del agente</CardDescription>
                        </div>
                    </div>
                    {isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                </div>
            </CardHeader>
            <CardContent>
                <ScrollArea className="h-[350px] pr-4">
                    <div className="space-y-4">
                        {notes.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-[250px] text-muted-foreground space-y-2">
                                <StickyNote className="w-12 h-12 opacity-20" />
                                <p className="text-sm">No hay notas guardadas</p>
                                <p className="text-[10px] opacity-70">El agente guardará notas con save_note</p>
                            </div>
                        ) : (
                            notes.map((note) => (
                                <div
                                    key={note.id}
                                    className="p-4 rounded-2xl border border-white/5 bg-card/40 hover:bg-card/60 transition-all duration-300 relative overflow-hidden"
                                >
                                    <h4 className="font-semibold text-sm mb-1.5 line-clamp-1">{note.key}</h4>
                                    <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
                                        {note.value}
                                    </p>
                                    <div className="mt-4 flex items-center justify-between">
                                        <Badge variant="secondary" className="text-[10px] px-2 py-0.5 bg-primary/10 text-primary border-none font-medium font-mono truncate max-w-[120px]">
                                            {note.thread_id.slice(-8)}
                                        </Badge>
                                        <span className="text-[10px] text-muted-foreground font-mono">
                                            {new Date(note.updated_at * 1000).toLocaleDateString()}
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
