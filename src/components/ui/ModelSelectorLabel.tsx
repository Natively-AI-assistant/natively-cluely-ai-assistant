import { modelSelectorLabelText } from './modelSelectorLabelText';

export function ModelSelectorLabel({ children }: { children: string }) {
  return <span className="flex-1 whitespace-nowrap">{modelSelectorLabelText(children)}</span>;
}
