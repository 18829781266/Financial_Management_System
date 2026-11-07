/** page-flip 2.0.7 的 npm 包未发布声明，此处只声明本组件实际使用的 ESM 接口。 */
declare module 'page-flip/dist/js/page-flip.module.js' {
  type Corner = 'top' | 'bottom'
  interface FlipSettings {
    width: number
    height: number
    size?: 'fixed' | 'stretch'
    minWidth?: number
    maxWidth?: number
    minHeight?: number
    maxHeight?: number
    maxShadowOpacity?: number
    showCover?: boolean
    drawShadow?: boolean
    flippingTime?: number
    usePortrait?: boolean
    startPage?: number
    autoSize?: boolean
    mobileScrollSupport?: boolean
    useMouseEvents?: boolean
    clickEventForward?: boolean
    showPageCorners?: boolean
    disableFlipByClick?: boolean
  }
  export class PageFlip {
    constructor(element: HTMLElement, settings: FlipSettings)
    loadFromHTML(elements: NodeListOf<HTMLElement> | HTMLElement[]): void
    on(event: string, callback: (event: { data: unknown; object: PageFlip }) => void): this
    destroy(): void
    flipNext(corner?: Corner): void
    flipPrev(corner?: Corner): void
    flip(index: number, corner?: Corner): void
    getCurrentPageIndex(): number
    getPageCount(): number
    update(): void
  }
}
