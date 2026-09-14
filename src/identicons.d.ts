declare module '@nimiq/identicons' {
  interface IdenticonsApi {
    toDataUrl(text: string): Promise<string>
  }

  const Identicons: IdenticonsApi
  export default Identicons
}
