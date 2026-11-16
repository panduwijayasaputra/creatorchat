import { ProfileForm } from '../profile/ProfileForm';

/** `/settings/profile` (creators): `CrEditProfile`, same form and rules as the customer edit. */
export function CreatorEditProfilePage() {
  return <ProfileForm backTo="/settings" />;
}
