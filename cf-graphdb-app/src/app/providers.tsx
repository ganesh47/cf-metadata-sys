// app/providers.tsx
'use client'
import {HeroUIProvider} from '@heroui/react'
import {ToastProvider} from "@heroui/toast";

export default function Providers({children}:any) {
    return (
        <HeroUIProvider>
            <ToastProvider placement={"top-center"} toastOffset={100}  />
            {children}
        </HeroUIProvider>
    )
}
