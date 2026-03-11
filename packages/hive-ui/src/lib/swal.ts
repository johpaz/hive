import Swal from "sweetalert2";

// Configuración personalizada para SweetAlert2 alineada con el tema "Hive"
export const swal = Swal.mixin({
    customClass: {
        confirmButton: "bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md font-medium transition-colors outline-none",
        cancelButton: "bg-destructive text-destructive-foreground hover:bg-destructive/90 px-4 py-2 rounded-md font-medium transition-colors outline-none",
        popup: "rounded-lg border border-border bg-card text-card-foreground shadow-lg overflow-hidden",
        title: "text-foreground font-bold text-xl",
        htmlContainer: "text-muted-foreground text-base",
    },
    buttonsStyling: false,
    background: "hsl(var(--card))",
    color: "hsl(var(--foreground))",
});

// Alias conveniente
export const Toast = Swal.mixin({
    toast: true,
    position: "top-end",
    showConfirmButton: false,
    timer: 3000,
    timerProgressBar: true,
    background: "hsl(var(--card))",
    color: "hsl(var(--foreground))",
    didOpen: (toast) => {
        toast.onmouseenter = Swal.stopTimer;
        toast.onmouseleave = Swal.resumeTimer;
    }
});
