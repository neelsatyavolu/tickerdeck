import { Shell } from "@/components/Shell";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return <Shell>{children}</Shell>;
}
