import { User as UserIcon } from 'lucide-react';
import { User } from '@/types/webrtc';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface UserListProps {
  users: User[];
  currentUserId: string;
  selectedUserId: string | null;
  onSelectUser: (userId: string) => void;
  disabled?: boolean;
}

const UserList = ({ users, currentUserId, selectedUserId, onSelectUser, disabled }: UserListProps) => {
  const otherUsers = users.filter(user => user.id !== currentUserId);

  return (
    <Card className="p-4 bg-card border-border">
      <h3 className="text-lg font-semibold text-foreground mb-4">Online Users</h3>
      <div className="space-y-2">
        {otherUsers.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No other users online
          </p>
        ) : (
          otherUsers.map(user => (
            <Button
              key={user.id}
              variant={selectedUserId === user.id ? 'default' : 'secondary'}
              className="w-full justify-start"
              onClick={() => onSelectUser(user.id)}
              disabled={disabled}
            >
              <UserIcon className="w-4 h-4 mr-2" />
              {user.name}
            </Button>
          ))
        )}
      </div>
    </Card>
  );
};

export default UserList;
