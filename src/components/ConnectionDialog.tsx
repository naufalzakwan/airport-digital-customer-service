import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { X } from 'lucide-react';

interface ConnectionDialogProps {
  open: boolean;
  onConnect: (userId: string) => void;
  onClose?: () => void;
}

const ConnectionDialog = ({ open, onConnect, onClose }: ConnectionDialogProps) => {
  const [userId, setUserId] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (userId.trim()) {
      onConnect(userId.trim());
    }
  };

  const handleClose = () => {
    if (onClose) {
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent
        className="sm:max-w-md bg-slate-800 border-slate-700"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <button
          onClick={handleClose}
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
        >
          <X className="h-4 w-4 text-emerald-400" />
          <span className="sr-only">Close</span>
        </button>

        <DialogHeader>
          <DialogTitle className="text-white text-xl">Connect to Video Call</DialogTitle>
          <p className="text-slate-400 text-sm mt-2">
            Enter a display name for internal direct-call testing.
          </p>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 mt-4">
          <div className="space-y-3">
            <Label htmlFor="userId" className="text-white font-medium">
              Display name
            </Label>
            <Input
              id="userId"
              placeholder="Enter a display name"
              maxLength={80}
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-400 focus:border-emerald-500 focus:ring-emerald-500"
              autoFocus
              required
            />
          </div>

          <Button
            type="submit"
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!userId.trim()}
          >
            Connect
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ConnectionDialog;
