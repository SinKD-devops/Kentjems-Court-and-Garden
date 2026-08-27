import Link from "next/link";
import type { Space } from "@/lib/availability";
import type { DateKey } from "@/lib/time";

export function SpaceTabs({
  spaces,
  active,
  date,
}: {
  spaces: Space[];
  active: string;
  date: DateKey;
}) {
  return (
    <nav aria-label="Choose a space">
      <ul className="flex gap-1">
        {spaces.map((space) => {
          const on = space.slug === active;
          return (
            <li key={space.id} className="flex-1">
              <Link
                href={`/?space=${space.slug}&date=${date}`}
                aria-current={on ? "page" : undefined}
                className={[
                  "block rounded-full py-1.5 text-center text-[13px] font-semibold",
                  on ? "bg-green text-white" : "text-soft",
                ].join(" ")}
              >
                {space.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
