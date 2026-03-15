#!/bin/bash
cd HomeFreeWorld

# Resolve conflict in app/actions/social.ts
sed -i -e '/<<<<<<< HEAD/,/=======/c\      return {\n          success: true,\n          data: randoms.map(u => ({\n            id: u.id,\n            firstName: u.firstName,\n            lastName: u.lastName,\n            profileImage: u.profileImage,\n            city: u.city,\n            country: null,\n            identityVerified: u.identityVerified,\n            trustLevel: undefined, // Not selected above\n            trustBonus: 5,\n            jobTitle: u.jobTitle,\n            propertyCount: u._count?.properties || 0,\n            role: u.role,\n            score: 0,\n            mutualFriends: 0,\n            mutualFriendPreviews: [],\n            reason: "New member"\n          }))\n      };' -e '/>>>>>>> origin\/feature\/network-expansion-polish-7610547164018700710/d' app/actions/social.ts

git add app/actions/social.ts
git commit -m "Merge and resolve conflict in app/actions/social.ts"
