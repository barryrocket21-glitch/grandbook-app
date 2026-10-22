export const STAGING_READONLY = process.env.NEXT_PUBLIC_GRANDBOOK_STAGING_READONLY === '1'

function readonlyError(action: string) {
  return new Error(`GrandBook staging read-only: ${action} diblok supaya data live tidak berubah.`)
}

export function protectSupabaseClient<T extends object>(client: T): T {
  if (!STAGING_READONLY && process.env.GRANDBOOK_STAGING_READONLY !== '1') return client

  const originalFrom = (client as any).from?.bind(client)
  const originalRpc = (client as any).rpc?.bind(client)

  if (!originalFrom || !originalRpc) return client

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'schema') {
        return (name: string) => protectSupabaseClient((target as any).schema(name))
      }
      if (prop === 'from') {
        return (table: string) => {
          const builder = originalFrom(table)
          return new Proxy(builder, {
            get(builderTarget, builderProp, builderReceiver) {
              if (['insert', 'update', 'upsert', 'delete'].includes(String(builderProp))) {
                return () => Promise.reject(readonlyError(`${String(builderProp)} ke ${table}`))
              }
              const value = Reflect.get(builderTarget, builderProp, builderReceiver)
              return typeof value === 'function' ? value.bind(builderTarget) : value
            },
          })
        }
      }

      if (prop === 'rpc') {
        return (fn: string) => {
          // RPC names do not prove read-only behavior; unknown calls fail closed.
          return Promise.reject(readonlyError(`RPC ${fn}`))
        }
      }

      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
