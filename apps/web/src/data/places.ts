/**
 * Curated list of interesting places in Santa Fe, NM.
 * Used for "nearby stop" suggestions on computed routes.
 *
 * Intentionally small and hand-picked for demo quality.
 * Coordinates are [longitude, latitude].
 */

export type PlaceCategory = "history" | "art" | "scenic" | "culture" | "civic";

export interface Place {
  name: string;
  category: PlaceCategory;
  coordinates: [number, number];
  description: string;
}

export const SANTA_FE_PLACES: Place[] = [
  {
    name: "San Miguel Chapel",
    category: "history",
    coordinates: [-105.9374, 35.6808],
    description: "Oldest church structure in the US, built around 1610",
  },
  {
    name: "Palace of the Governors",
    category: "history",
    coordinates: [-105.9398, 35.6872],
    description: "Oldest continuously occupied public building in the US",
  },
  {
    name: "Loretto Chapel",
    category: "history",
    coordinates: [-105.9379, 35.6853],
    description: "Famous for its mysterious spiral staircase",
  },
  {
    name: "Canyon Road Galleries",
    category: "art",
    coordinates: [-105.9295, 35.6815],
    description: "Half-mile stretch with over 100 galleries and studios",
  },
  {
    name: "Georgia O'Keeffe Museum",
    category: "art",
    coordinates: [-105.9420, 35.6879],
    description: "Dedicated to Georgia O'Keeffe and American Modernism",
  },
  {
    name: "Cathedral Basilica of St. Francis",
    category: "history",
    coordinates: [-105.9382, 35.6868],
    description: "Romanesque Revival cathedral, centerpiece of downtown",
  },
  {
    name: "Santa Fe Plaza",
    category: "culture",
    coordinates: [-105.9395, 35.6870],
    description: "Historic heart of the city since 1610",
  },
  {
    name: "Cross of the Martyrs",
    category: "scenic",
    coordinates: [-105.9440, 35.6900],
    description: "Hilltop cross with panoramic views of the Sangre de Cristos",
  },
  {
    name: "Museum of International Folk Art",
    category: "culture",
    coordinates: [-105.9223, 35.6714],
    description: "World's largest collection of international folk art",
  },
  {
    name: "Meow Wolf",
    category: "art",
    coordinates: [-105.9621, 35.6604],
    description: "Immersive art experience in a converted bowling alley",
  },
  {
    name: "Railyard Arts District",
    category: "art",
    coordinates: [-105.9444, 35.6830],
    description: "Galleries, studios, and the Saturday farmers market",
  },
  {
    name: "Museum of Indian Arts & Culture",
    category: "culture",
    coordinates: [-105.9225, 35.6720],
    description: "Stories of Native peoples of the Southwest from prehistory to today",
  },
  {
    name: "El Santuario de Guadalupe",
    category: "history",
    coordinates: [-105.9435, 35.6845],
    description: "Oldest shrine to Our Lady of Guadalupe in the US",
  },
  {
    name: "Santa Fe River Trail",
    category: "scenic",
    coordinates: [-105.9437, 35.6836],
    description: "Paved trail following the Santa Fe River through the city center",
  },
  {
    name: "Dale Ball Trails",
    category: "scenic",
    coordinates: [-105.9130, 35.6880],
    description: "20+ miles of trails in pinon-juniper foothills with mountain views",
  },
  {
    name: "Lensic Performing Arts Center",
    category: "culture",
    coordinates: [-105.9412, 35.6862],
    description: "Restored 1931 movie palace, now Santa Fe's premier performance venue",
  },
  {
    name: "Oldest House",
    category: "history",
    coordinates: [-105.9372, 35.6806],
    description: "Adobe structure dating to around 1646, among the oldest in the US",
  },
];
