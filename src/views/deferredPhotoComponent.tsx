import { Suspense, lazy, type ComponentProps, type ComponentType } from "react";

export function deferredPhotoComponent<Component extends ComponentType<any>>(
  loader: () => Promise<{ default: Component }>,
  displayName: string,
): Component {
  const LazyComponent = lazy(loader as () => Promise<{ default: ComponentType<any> }>);

  function DeferredPhotoComponent(props: ComponentProps<Component>) {
    return (
      <Suspense
        fallback={(
          <div className="photo-deferred-surface" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        )}
      >
        <LazyComponent {...props} />
      </Suspense>
    );
  }

  DeferredPhotoComponent.displayName = `Deferred(${displayName})`;
  return DeferredPhotoComponent as Component;
}
