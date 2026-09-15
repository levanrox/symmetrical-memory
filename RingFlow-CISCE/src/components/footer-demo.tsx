import React from "react"
import { Mail } from "lucide-react"
import { Footer } from "@/components/ui/footer"

export function FooterDemo() {
  return (
    <Footer
      brandName="RingFlow"
      backgroundImageUrl="/footer-karate.jpg"
      socialLinks={[
        {
          icon: <Mail className="h-[18px] w-[18px]" />,
          href: "mailto:contact@cruxstudios.dev",
          label: "Contact",
        },
      ]}
      mainLinks={[
        { href: "/#hero", label: "Home" },
        { href: "/#events", label: "Events" },
        { href: "mailto:contact@cruxstudios.dev", label: "Contact" },
      ]}
      legalLinks={[
        { href: "/privacy", label: "Privacy" },
        { href: "/terms", label: "Terms" },
      ]}
      copyright={{
        year: 2026,
        builtBy: (
          <a
            href="https://cruxstudios.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-[#1B1815] hover:bg-black text-[#F5F3EC] border border-[#E1DDCF]/40 hover:border-cyan-400/60 shadow-[0_4px_14px_rgba(27,24,21,0.15)] hover:shadow-[0_0_20px_rgba(0,229,255,0.3)] hover:-translate-y-0.5 transition-all duration-300"
          >
            <span className="font-['Inter',sans-serif] font-medium text-[12px] text-[#F5F3EC]/90 group-hover:text-white transition-colors">
              Built by
            </span>
            <div className="flex items-center gap-1.5">
              <img
                src="https://cruxstudios.dev/favicon.svg"
                alt="CruxStudios"
                className="h-4.5 w-4.5 drop-shadow-[0_0_6px_rgba(0,229,255,0.7)] group-hover:scale-110 group-hover:rotate-6 transition-all duration-300"
              />
              <span className="font-['Plus_Jakarta_Sans',sans-serif] font-black text-[13.5px] text-white tracking-tight group-hover:text-[#00E5FF] transition-colors">
                CruxStudios
              </span>
            </div>
            <svg
              className="w-3.5 h-3.5 text-[#F5F3EC]/80 group-hover:text-[#00E5FF] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-300"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M7 17L17 7M17 7H7M17 7V17" />
            </svg>
          </a>
        ),
      }}
    />
  )
}
